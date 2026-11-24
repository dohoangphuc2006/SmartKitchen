"""Lỗi nghiệp vụ dùng chung cho các API của ứng dụng."""


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, *, detection=None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detection = detection

