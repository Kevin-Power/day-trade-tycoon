#!/usr/bin/env python3
"""Reproducible learner manual from local JSON, embedded CJK fonts, no network."""
import argparse
import json
import os
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PW, PH = A4
M = 48
W = PW - M * 2
INK, TEAL, GRAY = [colors.HexColor(c) for c in ('#142C40', '#087E8B', '#506272')]
PALE, LINE = [colors.HexColor(c) for c in ('#EFF6F8', '#D4E1E6')]


def register_fonts():
    fontdir = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    normal = Path(os.environ.get('MANUAL_PDF_FONT', str(fontdir / 'msjh.ttc')))
    bold = Path(os.environ.get('MANUAL_PDF_FONT_BOLD', str(fontdir / 'msjhbd.ttc')))
    if not normal.exists():
        raise RuntimeError('Set MANUAL_PDF_FONT to a local TrueType CJK font.')
    if not bold.exists():
        bold = normal
    pdfmetrics.registerFont(TTFont('ManualSans', str(normal), subfontIndex=0))
    pdfmetrics.registerFont(TTFont('ManualBold', str(bold), subfontIndex=0))
    pdfmetrics.registerFontFamily('ManualSans', normal='ManualSans', bold='ManualBold', italic='ManualSans', boldItalic='ManualBold')


def para(text, size=10.8, leading=17, color=INK, bold=False):
    style = ParagraphStyle('manual', fontName='ManualBold' if bold else 'ManualSans', fontSize=size,
                           leading=leading, textColor=color, wordWrap='CJK', splitLongWords=False)
    return Paragraph(escape(str(text)).replace('\n', '<br/>'), style)


class Manual:
    def __init__(self, path, source):
        self.source = source
        self.c = canvas.Canvas(str(path), pagesize=A4, pageCompression=1, invariant=1)
        self.c.setTitle(source['title'])
        self.c.setAuthor('當沖大富翁教室')
        self.c.setSubject('學員入場、課綱、模擬操作與復盤')
        self.y = self.number = 0

    def check(self, height):
        if self.y - height < 52:
            raise RuntimeError(f'Page {self.number} overflow: y={self.y}, height={height}')

    def p(self, text, x=M, width=W, gap=9, **kwargs):
        p = para(text, **kwargs)
        _, h = p.wrap(width, PH)
        self.check(h)
        p.drawOn(self.c, x, self.y - h)
        self.y -= h + gap

    def begin(self, page, number):
        self.number = number
        self.c.setFillColor(INK)
        self.c.setFont('ManualBold', 9)
        self.c.drawString(M, PH - 34, '當沖大富翁')
        self.c.setFont('ManualSans', 8)
        self.c.setFillColor(GRAY)
        self.c.drawRightString(PW - M, PH - 34, '學員手冊 / ' + self.source['edition'])
        self.c.setStrokeColor(LINE)
        self.c.line(M, PH - 45, PW - M, PH - 45)
        self.y = PH - 76
        if page.get('kind') == 'cover':
            self.p('DAY TRADE TYCOON', size=10, leading=14, color=TEAL, bold=True, gap=18)
            self.p(page['title'], size=35, leading=44, bold=True, gap=4)
            self.p(page['subtitle'], size=23, leading=31, color=TEAL, bold=True, gap=20)
            self.p(page['intro'], size=12, leading=21, color=GRAY, gap=24)
        else:
            self.p(f"{number - 1:02d}  {page['kicker']}", size=9, leading=14, color=TEAL, bold=True, gap=9)
            self.p(page['title'], size=23, leading=31, bold=True, gap=12)
            self.p(page['intro'], color=GRAY, gap=18)

    def end(self):
        self.c.setStrokeColor(LINE)
        self.c.line(M, 39, PW - M, 39)
        self.c.setFont('ManualSans', 8)
        self.c.setFillColor(GRAY)
        self.c.drawString(M, 24, f"模擬教學用 / {self.source['version']}")
        self.c.drawRightString(PW - M, 24, f"{self.number:02d} / {len(self.source['pages']):02d}")
        self.c.showPage()

    def section(self, block):
        self.p(block['title'], size=12, leading=18, bold=True, gap=4)
        self.p(block['text'], color=GRAY, gap=15)

    def callout(self, block):
        title = para(block['title'], size=11.5, leading=17, color=TEAL, bold=True)
        body = para(block['text'], size=10.4, leading=16.5)
        _, th = title.wrap(W - 30, PH)
        _, bh = body.wrap(W - 30, PH)
        h = th + bh + 30
        self.check(h)
        self.c.setFillColor(PALE)
        self.c.roundRect(M, self.y - h, W, h, 7, fill=1, stroke=0)
        self.c.setFillColor(TEAL)
        self.c.rect(M, self.y - h + 8, 3, h - 16, fill=1, stroke=0)
        title.drawOn(self.c, M + 15, self.y - 12 - th)
        body.drawOn(self.c, M + 15, self.y - 18 - th - bh)
        self.y -= h + 17

    def table(self, block):
        data = [[para(v, size=9.8, leading=15, bold=True) for v in block['headers']]]
        data += [[para(v, size=10, leading=15.5, color=GRAY) for v in row] for row in block['rows']]
        table = Table(data, colWidths=[W * f for f in block['widths']], hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), PALE), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
            ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
            ('LINEBELOW', (0, 0), (-1, -1), 0.5, LINE)]))
        _, h = table.wrap(W, PH)
        self.check(h)
        table.drawOn(self.c, M, self.y - h)
        self.y -= h + 18

    def numbered(self, items):
        for number, title, body in items:
            self.c.setFillColor(TEAL)
            self.c.circle(M + 10, self.y - 9, 10, fill=1, stroke=0)
            self.c.setFillColor(colors.white)
            self.c.setFont('ManualBold', 10)
            self.c.drawCentredString(M + 10, self.y - 13, number)
            self.p(title, x=M + 32, width=W - 32, size=11.5, leading=18, bold=True, gap=3)
            self.p(body, x=M + 32, width=W - 32, size=10.6, leading=17, color=GRAY, gap=14)

    def steps(self, items):
        h, gap = 94, 12
        self.check(h)
        width = (W - gap * (len(items) - 1)) / len(items)
        top = self.y
        for index, (number, title, body) in enumerate(items):
            x = M + index * (width + gap)
            self.c.setFillColor(INK)
            self.c.roundRect(x, top - h, width, h, 7, fill=1, stroke=0)
            self.y = top - 10
            self.p(number, x=x + 12, width=width - 24, size=9, leading=13, color=colors.HexColor('#7FD4DC'), bold=True, gap=4)
            self.p(title, x=x + 12, width=width - 24, size=13, leading=18, color=colors.white, bold=True, gap=6)
            self.p(body, x=x + 12, width=width - 24, size=9, leading=14, color=colors.HexColor('#D7E7ED'), gap=0)
        self.y = top - h - 22

    def toc(self, items):
        self.p('需要哪一步，就翻到那一頁', size=12, leading=18, bold=True, gap=9)
        for number, title in items:
            self.p(f'{number}    {title}', size=10.5, leading=17, color=GRAY, gap=5)

    def qa(self, items):
        for question, answer in items:
            self.p(question, size=11, leading=17, bold=True, gap=3)
            self.p(answer, size=10.2, leading=16, color=GRAY, gap=11)

    def build(self):
        for i, page in enumerate(self.source['pages'], 1):
            self.begin(page, i)
            for block in page['blocks']:
                kind = block['kind']
                getattr(self, kind)(block if kind in ('section', 'callout', 'table') else block['items'])
            self.end()
        self.c.save()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / 'docs/pdf-source.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/daytrade-tycoon-manual.pdf')
    args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding='utf-8'))
    if not 6 <= len(source['pages']) <= 10:
        raise ValueError('The learner manual must have 6-10 pages.')
    register_fonts()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.partial.pdf')
    try:
        Manual(temporary, source).build()
        pdf = PdfReader(str(temporary))
        if len(pdf.pages) != len(source['pages']):
            raise RuntimeError('Page count does not match source.')
        text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        for term in ('09:00', '10:30', '富邦逐筆', '1,000 萬元', '保存復盤', '註冊帳號不等於完成繳費'):
            if term not in text:
                raise RuntimeError(f'Missing PDF text: {term}')
        os.replace(temporary, args.output)
        print(json.dumps({'output': str(args.output), 'pages': len(pdf.pages), 'bytes': args.output.stat().st_size, 'version': source['version']}, ensure_ascii=True))
    finally:
        if temporary.exists():
            temporary.unlink()


if __name__ == '__main__':
    main()
