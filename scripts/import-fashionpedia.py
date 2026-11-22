"""Export a local Fashionpedia polygon-annotation sample into a small, traceable catalog.
Requires Pillow. No model downloads or network requests. RLE is explicitly skipped.
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw

DISPLAY = {
    'dress': ('فستان خوخي دانتيل', 'خوخي', ['سهرة', 'زفاف'], 'فستان من عينة Fashionpedia'),
    'shirt, blouse': ('قميص أبيض', 'أبيض', ['يوم عمل', 'خروج يومي'], 'قميص من عينة Fashionpedia'),
    'pants': ('بنطال أسود - عينة جزئية', 'أسود', ['يوم عمل', 'خروج يومي'], 'تظهر القطعة جزئياً في صورة المصدر'),
}

def export_catalog(annotations, images_dir, project):
    source = json.loads(Path(annotations).read_text(encoding='utf-8'))
    images_dir = Path(images_dir).resolve()
    project = Path(project).resolve()
    assets = project / 'public' / 'assets' / 'fashionpedia'
    assets.mkdir(parents=True, exist_ok=True)
    images = {x['id']: x for x in source['images']}
    categories = {x['id']: x['name'] for x in source['categories']}
    attributes = {x['id']: x['name'] for x in source.get('attributes', [])}
    catalog, skipped = [], []
    for annotation in source['annotations']:
        category = categories[annotation['category_id']]
        if category not in DISPLAY:
            continue
        polygons = annotation.get('segmentation')
        if not isinstance(polygons, list):
            skipped.append({'annotationId': annotation['id'], 'reason': 'RLE requires a COCO mask decoder'})
            continue
        metadata = images[annotation['image_id']]
        image_path = (images_dir / metadata['file_name']).resolve()
        if not image_path.is_relative_to(images_dir):
            raise ValueError('Image path outside images directory')
        with Image.open(image_path) as image:
            image = image.convert('RGBA')
            mask = Image.new('L', image.size, 0)
            draw = ImageDraw.Draw(mask)
            for polygon in polygons:
                if len(polygon) >= 6 and len(polygon) % 2 == 0:
                    draw.polygon(list(zip(polygon[::2], polygon[1::2])), fill=255)
            bbox = mask.getbbox()
            if not bbox:
                skipped.append({'annotationId': annotation['id'], 'reason': 'Empty mask'})
                continue
            image.putalpha(mask)
            garment = image.crop(bbox)
            garment.thumbnail((640, 800))
            item_id = f"fp-{annotation['image_id']}-{annotation['id']}"
            filename = item_id + '.png'
            garment.save(assets / filename)
            flat = Image.new('RGBA', garment.size, 'white')
            flat.alpha_composite(garment)
            flat.convert('RGB').save(assets / (item_id + '-tryon.png'))
        name, color, occasions, detail = DISPLAY[category]
        catalog.append({
            'id': item_id, 'name': name, 'detail': detail,
            'image': '/assets/fashionpedia/' + filename,
            'tryOnImage': '/assets/fashionpedia/' + item_id + '-tryon.png',
            'category': category, 'colorName': color, 'occasions': occasions,
            'sourceImageId': annotation['image_id'], 'annotationId': annotation['id'],
            'sourceUrl': 'https://github.com/KMnP/fashionpedia-api/blob/master/images/' + metadata['file_name'],
            'attributeNames': [attributes[x] for x in annotation.get('attribute_ids', []) if x in attributes],
            'cropBox': list(bbox), 'maskType': 'polygon',
            'displayMetadata': 'Curated names/colors/occasions for these three demo samples, not predicted labels',
        })
    if not catalog:
        raise ValueError('No supported garment polygons were found')
    (project / 'public' / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    (project / 'data' / 'fashionpedia-provenance.json').write_text(json.dumps({
        'source': 'https://github.com/KMnP/fashionpedia-api/tree/master',
        'annotationSource': 'https://github.com/KMnP/fashionpedia-api/blob/master/data/sample.json',
        'description': source.get('info', {}), 'sampleOnly': True, 'items': catalog, 'skipped': skipped,
        'rightsNote': 'Sample images published with Fashionpedia API. Original photographer rights are retained; do not assume the API code license grants unrestricted image reuse.',
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'items': len(catalog), 'skipped': skipped}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--annotations', required=True)
    parser.add_argument('--images', required=True)
    parser.add_argument('--project', default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args()
    print(json.dumps(export_catalog(args.annotations, args.images, args.project)))
