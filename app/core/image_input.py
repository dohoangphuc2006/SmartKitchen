"""One upright RGB pixel coordinate system for uploaded images and PIL frames."""
from PIL import Image, ImageOps


def upright_rgb(image):
    """Apply EXIF once on a copy; never change caller pixels or the source file.

    The returned pixels have orientation 1 (or no orientation tag). Geometry
    from inference therefore uses the same axes as a browser's oriented image.
    """
    if isinstance(image, Image.Image):
        return ImageOps.exif_transpose(image).convert('RGB')
    with Image.open(image) as source:
        return ImageOps.exif_transpose(source).convert('RGB')
