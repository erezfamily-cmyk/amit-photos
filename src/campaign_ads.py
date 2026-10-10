"""Deterministic Amit Photos campaign brief and video assembly.

Paid visual/voice generation is deliberately external to this renderer. Supply
an approved 15-second source clip and five Hebrew voice MP3 files.
"""
import argparse
import datetime as dt
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / 'data/campaigns/amit-photos/plan.json'
W, H = 1080, 1920
TIMES = (0, 3.75, 7.5, 11.25, 15.033333)
AUDIO_MS = (550, 4150, 7900, 11650, 15400)
END_SECONDS = 4.8


def run(args):
    subprocess.run(args, check=True)


def concept_for(plan, identifier):
    return next((x for x in plan['concepts'] if x['id'] == identifier), None)


def url_for(plan, concept, month):
    destination = concept['destination']
    if not destination.startswith('/') or '//' in destination or '?' in destination:
        raise ValueError('destination must be a clean relative path')
    return plan['site'].rstrip('/') + destination + '?' + urlencode({
        'utm_source': 'social', 'utm_medium': 'social',
        'utm_campaign': month + '_character_photos',
        'utm_content': concept['id'],
    })


def brief(plan, concept, month):
    link = url_for(plan, concept, month)
    rows = [f'# {concept["title"]}', '', f'קמפיין: {month}',
            f'פתיח: {concept["hook"]}', f'צילום מקור: {concept["asset_requirement"]}',
            '', '| זמן | שוט | כתובית | קריינות |', '| --- | --- | --- | --- |']
    for i, shot in enumerate(concept['shots']):
        rows.append(f'| {TIMES[i]:.2f}–{TIMES[i+1]:.2f} | {shot} | {concept["captions"][i]} | {concept["narration"][i]} |')
    rows += ['', f'קריינות סיום: {concept["narration"][4]}',
             'שקופית סיום: בקרו באתר: amitphotos.com',
             f'קישור לחיץ לתיאור הפוסט: {link}', '',
             'פרומפט תנועה: photorealistic recurring Frame Inspector character from approved reference image; '
             'subtle physical comedy, natural skin and hands, no generated lettering, no voice, vertical 9:16. '
             'Use the four shots above. Preserve the same face and outfit.', '',
             'בדיקה: לאמת צילום מול /api/photos, לעבור על עברית וקול, לבדוק QR וקישור, לאשר טיוטה לפני פרסום.']
    return '\n'.join(rows) + '\n'


def draw_assets(concept, target_url, directory):
    from PIL import Image, ImageDraw, ImageFont
    from reportlab.graphics.barcode.qr import QrCodeWidget
    font_file = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    if not Path(font_file).is_file():
        raise RuntimeError('DejaVuSans-Bold font required')
    he = ImageFont.truetype(font_file, 64)
    small = ImageFont.truetype(font_file, 54)
    en = ImageFont.truetype(font_file, 76)

    def centered(draw, string, y, font, color, direction='rtl'):
        box = draw.textbbox((0, 0), string, font=font, direction=direction)
        draw.text(((W - (box[2] - box[0])) / 2, y), string,
                  font=font, fill=color, direction=direction)

    for n, caption in enumerate(concept['captions'], 1):
        image = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((76, 1560, W - 76, 1812), radius=43, fill=(12, 12, 12, 222))
        draw.rounded_rectangle((90, 1575, 105, 1798), radius=7, fill=(255, 215, 43, 255))
        centered(draw, caption, 1635, he if len(caption) <= 22 else small, 'white')
        image.save(directory / f'caption{n}.png')

    image = Image.new('RGB', (W, H), '#fdfcf9')
    draw = ImageDraw.Draw(image)
    centered(draw, 'בקרו באתר:', 580, he, '#111111')
    centered(draw, 'amitphotos.com', 720, en, '#111111', 'ltr')
    qr = QrCodeWidget(target_url)
    qr.qr.make()
    modules = qr.qr.modules
    cell, quiet = 12, 4
    size = (len(modules) + quiet * 2) * cell
    left, top = (W - size) // 2, 980
    draw.rounded_rectangle((left-20, top-20, left+size+20, top+size+20),
                           radius=25, fill='white', outline='#ffd72b', width=6)
    for row, cells in enumerate(modules):
        for col, active in enumerate(cells):
            if active:
                x, y = left + (col+quiet)*cell, top + (row+quiet)*cell
                draw.rectangle((x, y, x+cell-1, y+cell-1), fill='#111111')
    image.save(directory / 'end.png')


def render(plan, concept, source, audio_dir, output, month):
    if not source.is_file():
        raise FileNotFoundError(source)
    audio = [audio_dir / f'male{i}.mp3' for i in range(1, 6)]
    for path in audio:
        if not path.is_file():
            raise FileNotFoundError(path)
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(source)], text=True))
    if not 14.8 <= duration <= 15.3:
        raise ValueError(f'expected a ~15-second four-shot source, got {duration:.2f}s')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        draw_assets(concept, url_for(plan, concept, month), work)
        cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source)]
        for i in range(1, 5):
            cmd += ['-loop', '1', '-i', str(work / f'caption{i}.png')]
        graph = '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v0];'
        for i in range(1, 5):
            graph += f"[v{i-1}][{i}:v]overlay=0:0:enable='between(t,{TIMES[i-1]},{TIMES[i]-0.01})'[v{i}]"
            graph += ';' if i < 4 else ''
        visual = work / 'visual.mp4'
        run(cmd + ['-filter_complex', graph, '-map', '[v4]', '-t', str(TIMES[-1]), '-r', '30',
                   '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', str(visual)])
        end = work / 'end.mp4'
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-framerate', '30',
             '-i', str(work / 'end.png'), '-t', str(END_SECONDS), '-c:v', 'libx264',
             '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', str(end)])
        listing = work / 'list.txt'
        listing.write_text(f"file '{visual}'\nfile '{end}'\n")
        silent = work / 'silent.mp4'
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
             '-i', str(listing), '-c', 'copy', str(silent)])
        cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(silent)]
        for track in audio:
            cmd += ['-i', str(track)]
        filters = ';'.join(f'[{i}:a]adelay={delay}:all=1,volume=1.2[a{i}]'
                           for i, delay in enumerate(AUDIO_MS, 1))
        filters += ';' + ''.join(f'[a{i}]' for i in range(1, 6)) + \
                   'amix=inputs=5:duration=longest:dropout_transition=0[aout]'
        run(cmd + ['-filter_complex', filters, '-map', '0:v', '-map', '[aout]',
                   '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t',
                   str(TIMES[-1] + END_SECONDS), '-movflags', '+faststart', str(output)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['plan', 'render'])
    parser.add_argument('--concept', help='concept id; planning defaults to weekly rotation')
    parser.add_argument('--date', help='YYYY-MM-DD; defaults to today in UTC')
    parser.add_argument('--source', type=Path)
    parser.add_argument('--audio-dir', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    day = dt.date.fromisoformat(args.date) if args.date else dt.datetime.now(dt.timezone.utc).date()
    plan = json.loads(PLAN.read_text())
    concepts = plan['concepts']
    identifier = args.concept or concepts[(day.toordinal() // plan['cadence_days']) % len(concepts)]['id']
    selected = concept_for(plan, identifier)
    if selected is None:
        parser.error(f'unknown concept {identifier}')
    if len(selected['shots']) != 4 or len(selected['captions']) != 4 or len(selected['narration']) != 5:
        parser.error('each concept requires four shots/captions and five narration lines')
    month = day.strftime('%Y%m')
    if args.command == 'plan':
        output = args.output or Path(f'{identifier}-brief.md')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(brief(plan, selected, month))
    else:
        if not args.source or not args.audio_dir or not args.output:
            parser.error('render requires --source, --audio-dir and --output')
        render(plan, selected, args.source, args.audio_dir, args.output, month)
        output = args.output
    print(output)

if __name__ == '__main__':
    main()
