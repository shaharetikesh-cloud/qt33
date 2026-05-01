from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


def build_pdf(input_path: Path, output_path: Path) -> None:
    styles = getSampleStyleSheet()
    title_style = styles["Title"]
    body_style = styles["BodyText"]
    body_style.leading = 14

    lines = input_path.read_text(encoding="utf-8").splitlines()

    story = [Paragraph("QT33 DLR ERP - User Manual", title_style), Spacer(1, 12)]

    for raw in lines:
        line = raw.strip()
        if not line:
            story.append(Spacer(1, 8))
            continue

        if line.startswith("# "):
            story.append(Paragraph(f"<b>{line[2:]}</b>", styles["Heading1"]))
            story.append(Spacer(1, 6))
            continue
        if line.startswith("## "):
            story.append(Paragraph(f"<b>{line[3:]}</b>", styles["Heading2"]))
            story.append(Spacer(1, 4))
            continue
        if line.startswith("- "):
            story.append(Paragraph(f"&bull; {line[2:]}", body_style))
            continue

        safe = (
            line.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        story.append(Paragraph(safe, body_style))

    doc = SimpleDocTemplate(str(output_path), pagesize=A4)
    doc.build(story)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    build_pdf(
        root / "QT33DLRERP_User_Manual.md",
        root / "QT33DLRERP_User_Manual.pdf",
    )

