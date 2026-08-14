from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


OUTPUT = Path(__file__).with_name("pdf-annotation-test.pdf")
ROTATIONS = (0, 90, 180, 270)


def build_source() -> BytesIO:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    for rotation in ROTATIONS:
        pdf.setFont("Helvetica-Bold", 20)
        pdf.drawString(72, height - 90, f"Doku - rotation {rotation} degrees")
        pdf.setFont("Helvetica", 12)
        lines = (
            "This paragraph verifies a multi-line text selection.",
            "The TextLayer must remain aligned with the canvas.",
            "Every selected rectangle must stay inside the page.",
            f"Rotation marker: {rotation} degrees.",
        )
        for index, line in enumerate(lines):
            pdf.drawString(72, height - 140 - index * 24, line)

        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawString(72, height - 280, "Two-column reading order")
        pdf.setFont("Helvetica", 11)
        for index in range(3):
            y = height - 320 - index * 22
            pdf.drawString(72, y, f"Left column line {index + 1}.")
            pdf.drawString(width / 2 + 20, y, f"Right column line {index + 1}.")
        pdf.showPage()

    pdf.save()
    buffer.seek(0)
    return buffer


reader = PdfReader(build_source())
writer = PdfWriter()
for page, rotation in zip(reader.pages, ROTATIONS, strict=True):
    if rotation:
        page.rotate(rotation)
    writer.add_page(page)

with OUTPUT.open("wb") as stream:
    writer.write(stream)
