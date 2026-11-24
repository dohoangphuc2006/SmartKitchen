"""Ứng dụng chính: YOLO + recommendation + recipe detail, chỉ bind loopback."""

from __future__ import annotations

import os
import argparse
import importlib.util
from pathlib import Path
import socket
import sys

from core.detection_scope import PRECISION_GUARD


ROOT = Path(__file__).resolve().parent
# Không thêm dependency từ thư mục phát triển vào sys.path của bản bàn giao.
os.environ.setdefault("YOLO_CONFIG_DIR", str(ROOT / "Ultralytics"))

DEPENDENCIES = {'fastapi': 'fastapi', 'starlette': 'starlette', 'pydantic': 'pydantic',
                'uvicorn': 'uvicorn', 'multipart': 'python-multipart', 'PIL': 'pillow',
                'ultralytics': 'ultralytics', 'torch': 'torch', 'pandas': 'pandas', 'numpy': 'numpy', 'yaml': 'PyYAML'}
RECIPE_PROFILE = 'recipe'


def missing_dependencies(*, recipe_only=False):
    missing = []
    for module, distribution in DEPENDENCIES.items():
        if recipe_only and module in {'torch', 'ultralytics'}:
            continue
        try:
            found = importlib.util.find_spec(module)
        except (ImportError, ValueError):
            found = None
        if found is None:
            missing.append(distribution)
    return missing


def bind_local_port(port=8000):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.bind(('127.0.0.1', port))
        return sock
    except OSError:
        sock.close()
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Chỉ kiểm tra dependency/tệp/cổng, không nạp YOLO')
    parser.add_argument('--profile', choices=[RECIPE_PROFILE, 'legacy30', 'fridge11', 'fridge30_experimental', PRECISION_GUARD],
                        help='Dùng recipe cho Smart Kitchen gợi ý từ danh sách nguyên liệu')
    parser.add_argument('--with-yolo', action='store_true', help='Bật nhận diện ảnh tùy chọn cho profile recipe')
    parser.add_argument('--ranker', choices=['final', 'tfidf_cosine', 'quality_overlap', 'quality_hybrid', 'ml_tfidf', 'ml_lsa'], default='final',
                        help='Bộ xếp hạng cho profile recipe. Mặc định dùng baseline Stage 5 (final).')
    parser.add_argument('--class-aware-nms', action='store_true',
                        help='Thử nghiệm với Precision Guard: giữ box khác lớp chồng nhau để người dùng kiểm tra')
    parser.add_argument('--port', type=int, default=8000, help='Cổng loopback; không tự dừng server khác')
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('--port phải nằm trong 1..65535')
    if args.class_aware_nms and args.profile != PRECISION_GUARD:
        parser.error(f'--class-aware-nms cần chỉ định --profile {PRECISION_GUARD}')
    recipe_first = args.profile == RECIPE_PROFILE
    if (args.with_yolo or args.ranker != 'final') and not recipe_first:
        parser.error('--with-yolo và ranker thử nghiệm cần chỉ định --profile recipe')
    if args.profile and not recipe_first:
        os.environ['SMART_KITCHEN_PROFILE'] = args.profile
    os.chdir(ROOT)
    missing = missing_dependencies(recipe_only=recipe_first and not args.with_yolo)
    if missing:
        print('THIẾU DEPENDENCY: ' + ', '.join(missing), file=sys.stderr)
        print('Chạy setup_env.ps1 theo README.md để cài thư viện gợi ý món và ảnh/webcam.', file=sys.stderr)
        return 2
    required = ['processed/recipes_cleaned.csv', 'data/recipes_raw/SOURCE.json', 'mapping/ingredient_mapping.json',
                'config/app_config.json', 'frontend/index.html']
    if recipe_first:
        required += [
            'processed/ingredient_details.csv', 'processed/stage2_manifest.json',
            'processed/ingredient_display_vi.csv', 'processed/recipe_titles_vi.csv',
            'processed/recipe_detail_vi_v6_batch.json', 'processed/recipe_detail_vi_candidates.json',
            'processed/recipe_detail_vi_live_batch.json', 'processed/recipe_detail_vi_phase5_batch.json',
            'config/pantry_ingredient_catalog.json',
            'config/pantry_alias_overrides_v1.json', 'config/recommendation_config.json',
            'config/recipe_quality_ingredients.json', 'config/recipe_title_overrides_vi.json',
            'config/ingredient_display_vi.json', 'config/integration_config.json',
            'mapping/ingredient_aliases.json', 'mapping/ingredient_mapping.csv', 'mapping/yolo_classes.csv',
            'models/recipe_ml/recipe_tfidf_lsa_v1.npz',
            'models/recipe_ml/recipe_tfidf_lsa_v1.metadata.json',
            *('frontend/' + name for name in (
                'style.css', 'app.js', 'i18n.js', 'camera.js', 'detection.js', 'diagnostic_export.js',
            )),
        ]
    if not recipe_first or args.with_yolo:
        required += ['models/best.pt', 'core/detector.py']
    absent = [rel for rel in required if not (ROOT / rel).is_file()]
    if absent:
        print('THIẾU TỆP ỨNG DỤNG: ' + ', '.join(absent), file=sys.stderr)
        return 2
    try:
        sock = bind_local_port(args.port)
    except OSError as exc:
        print(f'KHÔNG THỂ DÙNG CỔNG {args.port}: {exc}', file=sys.stderr)
        print('Cổng có thể đang được dùng hoặc bị hệ điều hành hạn chế. '
              'Không tự dừng tiến trình khác; kiểm tra cửa sổ ứng dụng đang chạy.', file=sys.stderr)
        return 3
    try:
        if args.check:
            print(f'Preflight PASS: dependency có mặt, tệp chính tồn tại, cổng {args.port} trống. Chưa nạp model.')
            return 0
        import uvicorn
        print('SMART KITCHEN — ỨNG DỤNG CHÍNH', flush=True)
        print(f'URL: http://127.0.0.1:{args.port}/ — mở sau khi thấy Application startup complete.', flush=True)
        print('Nguyên liệu → gợi ý → chi tiết công thức. Ctrl+C để dừng.', flush=True)
        application = 'backend.main:app'
        if recipe_first or args.class_aware_nms:
            from backend.main import create_app
            from backend.services.smart_kitchen_service import SmartKitchenService

            application = create_app(lambda: SmartKitchenService(
                profile=args.profile, class_aware_nms=args.class_aware_nms, recipe_first=recipe_first,
                with_yolo=args.with_yolo, ranking_method=args.ranker))
        # Keep the checked socket until shutdown: another process cannot take the port in between.
        server = uvicorn.Server(uvicorn.Config(application, host='127.0.0.1', port=args.port,
                                              reload=False, workers=1))
        server.run(sockets=[sock])
        return 0 if server.started else 4
    except KeyboardInterrupt:
        return 0
    except (ImportError, OSError, ValueError) as exc:
        print(f'KHỞI ĐỘNG THẤT BẠI: {exc}', file=sys.stderr)
        print('Kiểm tra dependency và dữ liệu hiện có; không tải/train model khác.', file=sys.stderr)
        return 4
    finally:
        sock.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
