#!/usr/bin/env python3
"""Repeatable Croatian OCR; raw results are NEVER considered verified content."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, subprocess
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[1]
PDF = ROOT / 'assets/zadatci-za-upis-na-medicinski-fakultet-sveucilita-u-zagrebu-3nbsped-9789533680019_compress.pdf'
OUT = ROOT / 'var/medicine/ocr'
QUESTION_PAGES = set(range(12,34)) | set(range(36,69)) | set(range(72,102)) | set(range(105,140))
def ocr(base, psm):
    subprocess.run(['tesseract',str(base.with_suffix('.png')),str(base),'-l','hrv+eng','--psm',str(psm),'txt','tsv'],check=True,env={**os.environ,'OMP_THREAD_LIMIT':'1'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def page(n):
    base = OUT / f'page-{n:03d}'
    if not base.with_suffix('.png').exists():
        subprocess.run(['pdftoppm','-f',str(n),'-l',str(n),'-singlefile','-r','180','-png',str(PDF),str(base)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if not all(base.with_suffix(ext).exists() for ext in ('.txt','.tsv')):
        ocr(base,3)
    if n in QUESTION_PAGES:
        body = OUT / f'page-{n:03d}-body'
        if not body.with_suffix('.png').exists():
            with Image.open(base.with_suffix('.png')) as im:
                im.crop((0,int(im.height*.055),im.width,im.height)).save(body.with_suffix('.png'))
        if not all(body.with_suffix(ext).exists() for ext in ('.txt','.tsv')):
            ocr(body,6)
    return n
if __name__ == '__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--pages',default='1-148'); ap.add_argument('--workers',type=int,default=4); args=ap.parse_args()
    pages=[]
    for value in args.pages.split(','):
        a,_,b=value.partition('-'); pages.extend(range(int(a),int(b or a)+1))
    assert pages and all(1 <= n <= 148 for n in pages), "Pages must be within 1–148"
    OUT.mkdir(parents=True,exist_ok=True)
    manifest={'sha256':hashlib.sha256(PDF.read_bytes()).hexdigest(),'pages':148,'dpi':180,'languages':'hrv+eng','psm':3,'bodyPsm':6,'bodyTopCropFraction':0.055,'engine':subprocess.check_output(['tesseract','--version'],text=True).splitlines()[0]}
    previous=OUT.parent/'ocr-manifest.json'
    if previous.exists() and json.loads(previous.read_text())['sha256'] != manifest['sha256']:
        raise SystemExit('PDF changed: use a separate OCR cache and review the transcription again.')
    (OUT.parent/'ocr-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n in pool.map(page,pages): print(f'OCR {n}/148',flush=True)
