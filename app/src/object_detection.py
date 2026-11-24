"""Expose real YOLO geometry; filter each object before pantry aggregation.

Keep unfiltered post-NMS boxes separately for diagnostic evidence. No changes to
model weights, coordinates, classes or confidence values. Pixels stay in memory.
"""
import time
import math
from threading import Lock
from core.image_input import upright_rgb
from core.detection_scope import FULL30_PROFILES, PRECISION_GUARD
from src.detection_to_ingredient import load_integration_config
_PREDICT_LOCK = Lock()


def detect_objects(detector, image):
    started = time.perf_counter()
    picture = upright_rgb(image)
    model = detector.module.load_model()
    names = dict(enumerate(model.names)) if isinstance(model.names, list) else {int(k): v for k, v in model.names.items()}
    if names != detector.official_names:
        raise ValueError('Class contract conflict')
    # Identical to core.detector.detect's defaults, without rendering an image.
    scope = getattr(detector, 'scope', None)
    full30 = scope is not None and scope.profile in FULL30_PROFILES
    guard = scope is not None and scope.profile == PRECISION_GUARD
    policy = scope.inference if full30 else dict(imgsz=640,raw_confidence=.25,nms_iou=.5,agnostic_nms=False,max_det=300)
    kwargs = dict(conf=policy['raw_confidence'],iou=policy['nms_iou'],imgsz=policy['imgsz'],
                  agnostic_nms=policy['agnostic_nms'],max_det=policy['max_det'],verbose=False)
    if full30: kwargs['device']=policy['device']
    # YOLO's cached predictor arguments are shared: serialize configuration plus
    # inference across service instances, and explicitly reset shape/NMS args.
    with _PREDICT_LOCK:
        result = model.predict(picture, **kwargs)[0]
    aggregate, boxes, raw_boxes = {}, [], []
    box_threshold = scope.confidence if full30 else load_integration_config().detection_confidence_threshold
    for cls, confidence, xyxy in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist(), result.boxes.xyxy.tolist()):
        if guard:
            class_id = int(cls) if math.isfinite(cls) and cls == int(cls) else None
            name = names.get(class_id)
        else:
            class_id = int(cls)
            name = names[class_id]
        box = {'name': name, 'confidence': float(confidence), 'xyxy': [float(n) for n in xyxy]}
        if scope:
            box['class_id'] = class_id
            # Preserve invalid numeric values explicitly as text for JSON audit;
            # they remain excluded, rather than crashing JSON serialization.
            box['confidence'] = box['confidence'] if math.isfinite(box['confidence']) else str(box['confidence'])
            box['xyxy'] = [n if math.isfinite(n) else str(n) for n in box['xyxy']]
        raw_boxes.append(box)
    excluded = []
    partition = {}
    if guard:
        partition = scope.adjudicate(raw_boxes, picture.width, picture.height)
        boxes, excluded = partition['accepted_detections'], partition['rejected_detections']
    elif scope:
        boxes, excluded = scope.filter(raw_boxes, picture.width, picture.height, box_threshold)
    else:
        boxes = [b for b in raw_boxes if b['confidence'] >= box_threshold]
    for box in boxes:
        name, confidence = box['name'], box['confidence']
        # A strong prediction of the same class must not admit weak instances.
        item = aggregate.setdefault(name, {'name': name, 'confidence': 0., 'count': 0})
        if scope: item['class_id'] = box['class_id']
        item['count'] += 1
        item['confidence'] = max(item['confidence'], confidence)
    ingredients = [{**item, 'confidence': item['confidence'] if full30 else round(item['confidence'], 4)}
                   for item in sorted(sorted(aggregate.values(), key=lambda x: -x['count']), key=lambda x: -x['confidence'])]
    output = {'ingredients': ingredients, 'boxes': boxes, 'raw_boxes': raw_boxes,
            'policy': {'raw_confidence_threshold': policy['raw_confidence'], 'box_confidence_threshold': box_threshold,
                       'nms_iou': policy['nms_iou'], 'filter_scope': 'PER_OBJECT'},
            # Frontend displays the original with browser EXIF handling. These
            # dimensions/boxes already use those upright axes; do not rotate twice.
            'image': {'width': picture.width, 'height': picture.height, 'exif_orientation': 1},
            'detection_ms': round((time.perf_counter()-started)*1000, 3)}
    if scope:
        output.update(scope=scope.public(), excluded_detections=excluded)
        if full30:output['policy'].update(imgsz=policy['imgsz'],agnostic_nms=policy['agnostic_nms'],max_det=300,device='cpu',whitelist_enabled=False)
        else:output['policy']['class_whitelist'] = list(scope.allowed)
    output.update(partition)
    return output
