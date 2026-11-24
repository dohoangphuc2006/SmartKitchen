"""Explicit checkpoint selection; no pilot discovery or fallback."""
import hashlib,json,os
from pathlib import Path
def select_model(root):
    root=Path(root).resolve()
    config=json.loads((root/'config/runtime_model.json').read_text(encoding='utf-8'))
    configured=(root/config['model_path']).resolve()
    raw=os.environ.get('SMART_KITCHEN_MODEL_PATH')
    chosen=Path(raw) if raw else configured
    if not chosen.is_absolute():chosen=root/chosen
    chosen=chosen.resolve()
    expected=os.environ.get('SMART_KITCHEN_MODEL_SHA256') if raw else config['sha256']
    if chosen==configured and not expected:expected=config['sha256']
    if not expected or len(expected)!=64:raise ValueError('Checkpoint override cần SMART_KITCHEN_MODEL_SHA256; không fallback')
    if not chosen.is_file():raise FileNotFoundError(f'Không tìm thấy checkpoint đã chọn: {chosen}; không fallback sang pilot')
    return chosen,expected.lower()
def verify_model(path,expected):
    actual=hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if actual!=expected:raise ValueError(f'Checkpoint SHA-256 không khớp: {path}; không nạp model khác')
    return actual
