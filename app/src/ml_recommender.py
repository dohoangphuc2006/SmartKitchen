"""Fitted content-based recipe retrieval: TF-IDF and TF-IDF + TruncatedSVD (LSA).

Pure NumPy implementation because scikit-learn/scipy are not installed in
``.venv_clean``. Semantics follow scikit-learn:

* ``TfidfVectorizer(binary=True, smooth_idf=True, norm='l2')`` with an
  analyzer that emits one feature per canonical ingredient token;
* ``TruncatedSVD(algorithm='randomized')`` (Halko et al. 2011) with QR power
  iterations, a fixed seed and sign normalisation of the components.

Recipes and user pantries are mapped into the same feature space by the shared
``IngredientNormalizer`` (Vietnamese / English input -> canonical English
recipe tokens), so cross-language pantries use exactly the recipe vocabulary.
The model is unsupervised: no human relevance labels are used for fitting.
"""
from __future__ import annotations

import hashlib
import json
import math
import platform
import sys
import time
from pathlib import Path

import numpy as np

MODEL_VERSION = 'recipe_tfidf_lsa_v1'
ML_METHODS = ('ml_tfidf', 'ml_lsa')
ARTIFACT_DIR = Path('models') / 'recipe_ml'
ARTIFACT_NAME = f'{MODEL_VERSION}.npz'
METADATA_NAME = f'{MODEL_VERSION}.metadata.json'
DEFAULT_CONFIG = dict(
    features='canonical_ingredient_tokens',
    binary_tf=True,
    smooth_idf=True,
    norm='l2',
    min_df=1,
    n_components=100,
    n_oversamples=10,
    n_power_iter=7,
    random_state=42,
)
# Files whose content determines the fitted model; a mismatch makes the
# artifact stale and loading fails closed instead of silently mis-ranking.
FIT_INPUTS = (
    'processed/recipes_cleaned.csv',
    'config/recipe_quality_ingredients.json',
    'mapping/ingredient_aliases.json',
    'mapping/ingredient_mapping.json',
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


class CSRMatrix:
    """Minimal CSR matrix supporting the products needed by randomized SVD."""

    def __init__(self, data, indices, indptr, n_cols):
        self.data = np.asarray(data, dtype=np.float64)
        self.indices = np.asarray(indices, dtype=np.int64)
        self.indptr = np.asarray(indptr, dtype=np.int64)
        self.shape = (len(self.indptr) - 1, int(n_cols))
        self.rows = np.repeat(np.arange(self.shape[0]), np.diff(self.indptr))
        self.col_order = np.argsort(self.indices, kind='stable')
        counts = np.bincount(self.indices, minlength=self.shape[1])
        self.col_ptr = np.concatenate([[0], np.cumsum(counts)]).astype(np.int64)
        self.sorted_rows = self.rows[self.col_order]

    def dot(self, matrix):
        """X @ M for dense M of shape (n_cols, r)."""
        out = np.zeros((self.shape[0], matrix.shape[1]), dtype=np.float64)
        if len(self.data) > 0:
            np.add.at(out, self.rows, self.data[:, None] * matrix[self.indices])
        return out

    def tdot(self, matrix):
        """X.T @ M for dense M of shape (n_rows, r)."""
        out = np.zeros((self.shape[1], matrix.shape[1]), dtype=np.float64)
        if len(self.data) > 0:
            np.add.at(out, self.indices, self.data[:, None] * matrix[self.rows])
        return out

    def column_rows(self, column):
        start, end = self.col_ptr[column], self.col_ptr[column + 1]
        return self.sorted_rows[start:end]


def randomized_svd(matrix: CSRMatrix, n_components, n_oversamples, n_power_iter, random_state):
    rng = np.random.default_rng(random_state)
    rank = n_components + n_oversamples
    q = matrix.dot(rng.standard_normal((matrix.shape[1], rank)))
    for _ in range(n_power_iter):
        q, _ = np.linalg.qr(q)
        z, _ = np.linalg.qr(matrix.tdot(q))
        q = matrix.dot(z)
    q, _ = np.linalg.qr(q)
    small = matrix.tdot(q).T  # (rank, n_cols)
    _, singular, vt = np.linalg.svd(small, full_matrices=False)
    vt, singular = vt[:n_components], singular[:n_components]
    # Deterministic sign: largest-magnitude loading of each component positive.
    pivots = np.argmax(np.abs(vt), axis=1)
    vt = vt * np.sign(vt[np.arange(len(vt)), pivots])[:, None]
    return singular, vt


class TfidfLsaModel:
    """Fitted TF-IDF vocabulary/IDF, recipe TF-IDF matrix and LSA projection."""

    def __init__(self, vocabulary, idf, csr: CSRMatrix, components, singular_values,
                 recipe_row_ids, explained_variance_ratio, config):
        self.vocabulary = list(vocabulary)
        self.vocab_index = {token: i for i, token in enumerate(self.vocabulary)}
        self.idf = np.asarray(idf, dtype=np.float64)
        self.csr = csr
        self.components = np.asarray(components, dtype=np.float64)
        self.singular_values = np.asarray(singular_values, dtype=np.float64)
        self.recipe_row_ids = [str(x) for x in recipe_row_ids]
        self.explained_variance_ratio = np.asarray(explained_variance_ratio, dtype=np.float64)
        self.config = dict(config)
        embedding = csr.dot(self.components.T)
        norms = np.linalg.norm(embedding, axis=1)
        self.recipe_lsa = embedding / np.where(norms > 0, norms, 1.0)[:, None]

    # ------------------------------------------------------------------ fit
    @classmethod
    def fit(cls, documents, recipe_row_ids, config=None):
        config = {**DEFAULT_CONFIG, **(config or {})}
        docs = [sorted(set(doc)) for doc in documents]
        if len(docs) != len(recipe_row_ids) or not docs:
            raise ValueError('documents and recipe_row_ids must be non-empty and aligned')
        df = {}
        for doc in docs:
            for token in doc:
                df[token] = df.get(token, 0) + 1
        vocabulary = sorted(t for t, count in df.items() if count >= config['min_df'])
        index = {t: i for i, t in enumerate(vocabulary)}
        n_docs = len(docs)
        df_arr = np.array([df[t] for t in vocabulary], dtype=np.float64)
        idf = (np.log((1 + n_docs) / (1 + df_arr)) + 1.0) if config['smooth_idf'] else (np.log(n_docs / df_arr) + 1.0)
        data, indices, indptr = [], [], [0]
        for doc in docs:
            ids = sorted(index[t] for t in doc if t in index)
            weights = idf[ids]
            norm = math.sqrt(float(np.dot(weights, weights))) or 1.0
            data.extend((weights / norm).tolist())
            indices.extend(ids)
            indptr.append(len(indices))
        csr = CSRMatrix(data, indices, indptr, len(vocabulary))
        singular, components = randomized_svd(csr, config['n_components'], config['n_oversamples'],
                                               config['n_power_iter'], config['random_state'])
        transformed = csr.dot(components.T)
        col_sum = np.bincount(csr.indices, weights=csr.data, minlength=csr.shape[1])
        col_sq = np.bincount(csr.indices, weights=csr.data ** 2, minlength=csr.shape[1])
        total_var = float(np.sum(col_sq / n_docs - (col_sum / n_docs) ** 2))
        explained = np.var(transformed, axis=0) / total_var
        return cls(vocabulary, idf, csr, components, singular, recipe_row_ids, explained, config)

    # ---------------------------------------------------------- persistence
    def save(self, path: Path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('wb') as stream:
            np.savez(
                stream,
                vocabulary=np.array(self.vocabulary, dtype=str),
                idf=self.idf,
                tfidf_data=self.csr.data,
                tfidf_indices=self.csr.indices,
                tfidf_indptr=self.csr.indptr,
                components=self.components,
                singular_values=self.singular_values,
                explained_variance_ratio=self.explained_variance_ratio,
                recipe_row_ids=np.array(self.recipe_row_ids, dtype=str),
                config_json=np.array(json.dumps(self.config, sort_keys=True)),
            )
        return sha256_file(path)

    @classmethod
    def load(cls, path: Path):
        with np.load(Path(path), allow_pickle=False) as npz:
            vocabulary = npz['vocabulary'].tolist()
            csr = CSRMatrix(npz['tfidf_data'], npz['tfidf_indices'], npz['tfidf_indptr'], len(vocabulary))
            return cls(vocabulary, npz['idf'], csr, npz['components'], npz['singular_values'],
                       npz['recipe_row_ids'].tolist(), npz['explained_variance_ratio'],
                       json.loads(str(npz['config_json'])))

    # ------------------------------------------------------------- scoring
    def query_vector(self, tokens):
        ids = sorted({self.vocab_index[t] for t in tokens if t in self.vocab_index})
        weights = self.idf[ids]
        norm = float(np.linalg.norm(weights))
        return np.array(ids, dtype=np.int64), (weights / norm if norm else weights)

    def tfidf_scores(self, ids, weights):
        dense = np.zeros(self.csr.shape[1])
        dense[ids] = weights
        return self.csr.dot(dense[:, None]).ravel()

    def lsa_scores(self, ids, weights):
        projected = self.components[:, ids] @ weights
        norm = float(np.linalg.norm(projected))
        if not norm:
            return np.zeros(self.csr.shape[0])
        return self.recipe_lsa @ (projected / norm)


def build_documents(quality_recommender):
    """Canonical ingredient token documents in catalog order (shared normalizer)."""
    index = quality_recommender.index
    names = index.id_to_name
    docs = [[names[i] for i in recipe.ingredient_ids] for recipe in index.recipes]
    return docs, [recipe.row_id for recipe in index.recipes]


def fit_inputs_digest(root: Path):
    return {rel: sha256_file(Path(root) / rel) for rel in FIT_INPUTS}


def environment_info():
    return dict(python=sys.version.split()[0], numpy=np.__version__, platform=platform.platform(),
                implementation='pure_numpy (scikit-learn not installed)')


class MLRecipeRecommender:
    """Inference wrapper: shared normalizer -> fitted TF-IDF/LSA -> Top-N."""

    def __init__(self, quality_recommender, model: TfidfLsaModel, metadata: dict, artifact_sha256: str):
        index = quality_recommender.index
        if model.recipe_row_ids != [r.row_id for r in index.recipes]:
            raise ValueError('ML artifact recipe order does not match the current catalog; refit the model')
        if set(model.vocabulary) != set(index.name_to_id):
            raise ValueError('ML artifact vocabulary does not match the current normalizer; refit the model')
        self.quality = quality_recommender
        self.normalize = quality_recommender.normalize
        self.model = model
        self.metadata = metadata
        self.artifact_sha256 = artifact_sha256
        self.default_config = quality_recommender.default_config
        csr = model.csr
        self.recipe_sizes = np.diff(csr.indptr)
        self.vocabulary_set = set(model.vocabulary)

    @classmethod
    def load(cls, root: Path, quality_recommender=None, artifact_dir: Path | None = None):
        root = Path(root)
        folder = Path(artifact_dir) if artifact_dir else root / ARTIFACT_DIR
        artifact, meta_path = folder / ARTIFACT_NAME, folder / METADATA_NAME
        if not artifact.is_file() or not meta_path.is_file():
            raise FileNotFoundError(f'Thiếu artifact ML: {artifact} (chạy scripts/train_ml_recommender.py)')
        metadata = json.loads(meta_path.read_text(encoding='utf-8'))
        artifact_sha = sha256_file(artifact)
        if artifact_sha != metadata.get('artifact_sha256'):
            raise ValueError('ML artifact SHA-256 differs from its metadata')
        if fit_inputs_digest(root) != metadata.get('fit_inputs_sha256'):
            raise ValueError('Dataset/normalizer inputs changed since the model was fitted; refit the model')
        if quality_recommender is None:
            from src.recipe_quality import RecipeQualityRecommender
            from src.recommender import Recommender
            quality_recommender = RecipeQualityRecommender(Recommender(root))
        return cls(quality_recommender, TfidfLsaModel.load(artifact), metadata, artifact_sha)

    def recommend(self, user_ingredients, top_n=5, method='ml_lsa', return_diagnostics=False, mode='gated',
                  *, eligible_recipe_ids: set[str] | None = None):
        if method not in ML_METHODS or top_n < 0:
            raise ValueError(f'method phải thuộc {ML_METHODS} và top_n >= 0')
        if mode not in {'gated', 'open'}:
            raise ValueError("mode phải là 'gated' hoặc 'open'")
        started = time.perf_counter()
        parsed = self.normalize.normalize_pantry(user_ingredients, vocabulary=self.vocabulary_set)
        tokens = parsed['normalized_ingredients']
        warnings = list(parsed['warnings'])
        diagnostics = dict(recommendations=[], normalized_ingredients=tokens,
                           unresolved_ingredients=parsed['unresolved_ingredients'],
                           normalization_details=parsed['items'], warnings=warnings,
                           candidate_count=0, qualified_count=0, method=method, mode=mode,
                           model_version=MODEL_VERSION, artifact_sha256=self.artifact_sha256,
                           empty_reason=None)
        if not tokens or not top_n:
            diagnostics['empty_reason'] = 'NO_RECOGNIZED_INGREDIENTS' if not tokens else 'TOP_N_ZERO'
            diagnostics['inference_ms'] = (time.perf_counter() - started) * 1000
            return diagnostics if return_diagnostics else []
        model = self.model
        ids, weights = model.query_vector(tokens)
        # Exact-overlap counts via the inverted index (same gate for every ranker).
        hits = np.concatenate([model.csr.column_rows(i) for i in ids])
        matched = np.bincount(hits, minlength=model.csr.shape[0])
        candidates = np.flatnonzero(matched)
        diagnostics['candidate_count'] = int(len(candidates))
        if mode == 'gated':
            group_count = self.normalize.count_ingredient_groups(tokens)
            min_matched = min(group_count, self.default_config.min_matched_ingredients)
            ratio = matched[candidates] / self.recipe_sizes[candidates]
            keep = (matched[candidates] >= min_matched) & (ratio >= self.default_config.min_match_ratio)
        else:
            keep = matched[candidates] >= 1
        if eligible_recipe_ids is not None:
            keep &= np.array([model.recipe_row_ids[i] in eligible_recipe_ids for i in candidates], dtype=bool)
        eligible = candidates[keep]
        diagnostics['qualified_count'] = int(len(eligible))
        if not len(eligible):
            diagnostics['empty_reason'] = 'NO_CANDIDATE_PASSED_ELIGIBILITY'
            warnings.append('Không có công thức đạt điều kiện lọc chung (số nguyên liệu khớp / tỉ lệ khớp).')
            diagnostics['inference_ms'] = (time.perf_counter() - started) * 1000
            return diagnostics if return_diagnostics else []
        tfidf = model.tfidf_scores(ids, weights)
        lsa = model.lsa_scores(ids, weights)
        primary = tfidf if method == 'ml_tfidf' else lsa
        recipes = self.quality.index.recipes
        sizes = self.recipe_sizes
        order = sorted(eligible.tolist(), key=lambda i: (-round(float(primary[i]), 12), -int(matched[i]),
                                                         int(sizes[i] - matched[i]), int(recipes[i].row_id)))
        pantry_ids = set(ids.tolist())
        vocab = model.vocabulary
        seen, result = set(), []
        for i in order:
            recipe = recipes[i]
            title = ' '.join(recipe.recipe_name.casefold().split())
            if title in seen:
                continue
            seen.add(title)
            row_tokens = model.csr.indices[model.csr.indptr[i]:model.csr.indptr[i + 1]].tolist()
            matched_ids = [t for t in row_tokens if t in pantry_ids]
            missing = sorted(vocab[t] for t in row_tokens if t not in pantry_ids)
            key = sorted(matched_ids, key=lambda t: (-model.idf[t], vocab[t]))[:3]
            result.append(dict(
                recipe_id=recipe.row_id, recipe_name=recipe.recipe_name,
                score=float(primary[i]), ml_tfidf_cosine=float(tfidf[i]), ml_lsa_cosine=float(lsa[i]),
                match_ratio=int(matched[i]) / int(sizes[i]), matched_count=int(matched[i]),
                missing_count=len(missing), matched_ingredients=sorted(vocab[t] for t in matched_ids),
                missing_ingredients=missing, key_matches=[vocab[t] for t in key],
                ready_for_mapping=recipe.ready_for_mapping,
            ))
            if len(result) == top_n:
                break
        diagnostics['recommendations'] = result
        diagnostics['inference_ms'] = (time.perf_counter() - started) * 1000
        return diagnostics if return_diagnostics else result
