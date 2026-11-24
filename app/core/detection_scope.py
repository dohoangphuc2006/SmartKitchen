"""Explicit local scope profile; never reindex classes or change model weights."""
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE_SHA = 'c67106a099bb625912a461eee00fe1e09bda9ea8a7a0f55da34abaace3f7f8cf'
AUTHORIZED = {0:'apple',1:'banana',7:'cheese',11:'corn',12:'eggs',19:'lime',21:'mushrooms',
              22:'onion',24:'shrimp',26:'strawberries',29:'tomato'}
PRECISION_GUARD = 'fridge30_precision_guard'
FULL30_PROFILES = {'fridge30_experimental', PRECISION_GUARD}
ABSTENTION_NOTICE = 'Chưa xác định chắc chắn nguyên liệu trong ảnh'
DECISION_FIELDS = ('raw_detections', 'accepted_detections', 'review_candidates',
                   'rejected_detections', 'confirmed_pantry')


@dataclass(frozen=True)
class DetectionScope:
    profile: str
    allowed: dict
    ontology: dict
    model_sha256: str
    confidence: float
    notice: str
    inference: dict | None = None

    @property
    def requires_confirmation(self):
        return self.profile in FULL30_PROFILES

    def verify_model(self, path, names, expected_hash):
        names=dict(enumerate(names)) if isinstance(names,list) else {int(k):v for k,v in names.items()}
        if names != self.ontology or len(names)!=30:
            raise ValueError('FRIDGE11 ONTOLOGY MISMATCH: cần đúng head 30 lớp baseline, không reindex')
        actual=hashlib.sha256(Path(path).read_bytes()).hexdigest()
        if actual != self.model_sha256 or expected_hash != self.model_sha256:
            raise ValueError('FRIDGE11 CHECKPOINT MISMATCH: chỉ dùng baseline đã kiểm toán')

    def public(self):
        result = dict(profile=self.profile,environment='LOCAL_EXPERIMENT_ONLY',model_sha256=self.model_sha256,
            head_classes=30,supported_classes=[dict(class_id=c,name=n) for c,n in self.allowed.items()],
            box_confidence_threshold=self.confidence,notice=self.notice,
            confidence_is_calibrated_probability=False)
        if self.requires_confirmation:
            result.update(inference=self.inference,whitelist_enabled=False,ingredient_confirmation_required=True)
        if self.profile == PRECISION_GUARD:
            result['acceptance_mode'] = 'REVIEW_ONLY'
        return result

    def adjudicate(self, raw_boxes, width, height):
        """Partition post-NMS output. Technical validity never verifies food identity."""
        review, rejected = [], []
        for index, box in enumerate(raw_boxes):
            class_id = box.get('class_id')
            if type(class_id) is not int or class_id not in self.ontology:
                reason = 'OUT_OF_SCOPE'
            elif self.ontology[class_id] != box.get('name'):
                reason = 'CLASS_MAPPING_MISMATCH'
            else:
                _, excluded = self.filter([box], width, height, self.confidence)
                reason = excluded[0]['reason'] if excluded else None
            decision = dict(box, raw_index=index, decision='REJECT' if reason else 'REVIEW',
                            reason=reason or 'NO_VALIDATED_ACCEPTANCE_RULE',
                            evidence={'raw_index': index, 'stage': 'POST_NMS',
                                      'technical_checks_passed': reason is None,
                                      'validated_acceptance_rule': None})
            (rejected if reason else review).append(decision)
        return dict(raw_detections=raw_boxes, accepted_detections=[],
                    review_candidates=review, rejected_detections=rejected, confirmed_pantry=[])

    def filter(self, raw_boxes, width, height, threshold):
        if threshold != self.confidence:
            raise ValueError('FRIDGE11 confidence config conflict; không chạy hai threshold khác nhau')
        kept,excluded=[],[]
        for index,box in enumerate(raw_boxes):
            reason=None
            if self.allowed.get(box.get('class_id')) != box.get('name'):
                reason='OUT_OF_SCOPE'
            else:
                co=box.get('confidence');xy=box.get('xyxy')
                if not isinstance(co,(float,int)) or isinstance(co,bool) or not math.isfinite(co) or not 0<=co<=1:
                    reason='INVALID_CONFIDENCE'
                elif (not isinstance(xy,list) or len(xy)!=4 or
                      any(not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v) for v in xy) or
                      not (0<=xy[0]<xy[2]<=width and 0<=xy[1]<xy[3]<=height)):
                    reason='INVALID_GEOMETRY'
                elif co<threshold:reason='BELOW_CONFIDENCE'
            if reason:excluded.append(dict(**box,raw_index=index,reason=reason))
            else:kept.append(box)
        return kept,excluded


def load_scope(profile=None, root=ROOT, *, class_aware_nms=False):
    profile=profile if profile is not None else os.environ.get('SMART_KITCHEN_PROFILE','legacy30')
    if class_aware_nms and profile != PRECISION_GUARD:
        raise ValueError('Class-aware NMS thử nghiệm chỉ dùng với Precision Guard REVIEW_ONLY')
    if profile=='legacy30':return None
    if profile in FULL30_PROFILES:
        data=json.loads((Path(root)/'config/fridge30_experimental.json').read_text(encoding='utf-8'))
        reference=json.loads((Path(root)/'config/fridge11_scope.json').read_text(encoding='utf-8'))
        if (data['model_sha256']!=BASELINE_SHA or data['class_ids']!=list(range(30)) or
            any(type(c) is not int for c in data['class_ids']) or data['ontology_names']!=reference['ontology_names'] or
            data['class_names']!=data['ontology_names'] or data['expected_head_classes']!=30):
            raise ValueError('FULL30 audited ontology/checkpoint mismatch; no reindex')
        p=data['inference'];co=data['expected_box_confidence']
        if (set(p)!={'imgsz','raw_confidence','nms_iou','agnostic_nms','max_det','device'} or
            type(co) not in (int,float) or not 0<co<=1 or
            type(p['raw_confidence']) not in (int,float) or not 0<p['raw_confidence']<=co or
            type(p['imgsz']) is not int or not 320<=p['imgsz']<=1536 or p['imgsz']%32 or
            type(p['nms_iou']) not in (int,float) or not 0<p['nms_iou']<=1 or
            type(p['agnostic_nms']) is not bool or p['max_det']!=300 or p['device']!='cpu'):
            raise ValueError('FULL30 invalid reproducible inference policy')
        ontology=dict(enumerate(data['ontology_names']))
        notice = data['notice']
        if profile == PRECISION_GUARD:
            guard = json.loads((Path(root)/'config/fridge30_precision_guard.json').read_text(encoding='utf-8'))
            if (guard.get('base_profile') != 'fridge30_experimental' or guard.get('acceptance_mode') != 'REVIEW_ONLY'
                    or guard.get('validated_acceptance_rules') != [] or not isinstance(guard.get('notice'), str)):
                raise ValueError('Precision Guard requires REVIEW_ONLY until acceptance rules are validated')
            notice = guard['notice']
            if class_aware_nms:
                p = {**p, 'agnostic_nms': False}
        return DetectionScope(profile,ontology,ontology,BASELINE_SHA,co,notice,p)
    if profile!='fridge11':raise ValueError(f'Unknown detection profile: {profile}')
    data=json.loads((Path(root)/'config/fridge11_scope.json').read_text(encoding='utf-8'))
    ids=data['class_ids'];names=data['class_names']
    if (len(ids)!=11 or any(not isinstance(c,int) or isinstance(c,bool) for c in ids) or
            len(set(ids))!=11 or dict(zip(ids,names))!=AUTHORIZED or len(names)!=11):
        raise ValueError('FRIDGE11 whitelist không khớp 11 ID/tên Owner đã duyệt')
    if data['model_sha256']!=BASELINE_SHA or data['expected_box_confidence']!=.35:
        raise ValueError('FRIDGE11 audited identity/confidence config mismatch')
    ontology=dict(enumerate(data['ontology_names']))
    if data['expected_head_classes']!=30 or len(ontology)!=30 or any(ontology.get(c)!=n for c,n in AUTHORIZED.items()):
        raise ValueError('FRIDGE11 ontology config conflict')
    return DetectionScope('fridge11',dict(zip(ids,names)),ontology,data['model_sha256'],
                          data['expected_box_confidence'],data['notice'])
