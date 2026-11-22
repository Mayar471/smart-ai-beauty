// Single source of truth for every selectable option.
// Imported by the browser UI and by the Node server, so validation, display and image prompts never drift.

export { hairstyles } from './hairstyles.js';

export const occasionTypes = [
  'تخرج',
  'زواج',
  'خطوبة',
  'مقابلة عمل',
  'يوم عمل',
  'سهرة',
  'خروج يومي',
  'مناسبة أخرى',
];

export const garmentCategories = {
  dress: 'فستان / عباءة',
  'shirt, blouse': 'قميص / بلوزة',
  pants: 'بنطال',
  skirt: 'تنورة',
  outerwear: 'جاكيت / طبقة خارجية',
  shoes: 'حذاء',
  bag: 'حقيبة',
  accessory: 'إكسسوار',
};

export const hairColors = [
  { name: 'أسود', value: '#1c1512', prompt: 'natural black' },
  { name: 'بني داكن', value: '#372820', prompt: 'dark brown' },
  { name: 'كستنائي', value: '#704738', prompt: 'chestnut brown' },
  { name: 'نحاسي', value: '#9a4f2c', prompt: 'copper auburn' },
  { name: 'عسلي', value: '#a57842', prompt: 'honey brown' },
  { name: 'أشقر دافئ', value: '#bea071', prompt: 'warm blonde' },
];

// Hijab wraps replace the hairstyle step for users who wear the hijab.
export const hijabStyles = [
  {
    id: 'classic',
    name: 'لفة كلاسيكية',
    detail: 'ناعمة ومنسدلة على الصدر · لكل يوم',
    prompt: 'a classic hijab wrapped smoothly around the face with the fabric draped softly over the chest',
  },
  {
    id: 'turkish',
    name: 'لفة تركية',
    detail: 'إطار مرتب حول الوجه · رسمية',
    prompt:
      'a Turkish-style square satin hijab, neatly framed around the face with a structured crown and the ends tucked in at the neck',
  },
  {
    id: 'shayla',
    name: 'شيلة منسدلة',
    detail: 'طيات طويلة ناعمة · أنيقة',
    prompt:
      'a long rectangular shayla hijab wrapped around the head with soft flowing folds falling over one shoulder',
  },
  {
    id: 'layered',
    name: 'لفة بطبقات',
    detail: 'حجم جانبي بطيات · للمناسبات',
    prompt: 'a voluminous layered hijab with soft pleated folds gathered on one side of the head',
  },
  {
    id: 'practical',
    name: 'لفة عملية',
    detail: 'ثابتة وبسيطة · للعمل والحركة',
    prompt: 'a simple snug jersey hijab, minimal and neat, closely fitted around the face',
  },
  {
    id: 'khimar',
    name: 'خمار طويل',
    detail: 'يغطي الكتفين والصدر',
    prompt: 'a long flowing khimar covering the head, shoulders and chest down to the waist',
  },
  {
    id: 'pinned',
    name: 'لفة جانبية بدبوس',
    detail: 'مثبتة بدبوس أنيق عند الجانب',
    prompt: 'a chiffon hijab draped across the chest and fastened at the side of the head with a small pin',
  },
  {
    id: 'evening',
    name: 'لفة سهرة',
    detail: 'ساتان بانسدال راقٍ',
    prompt: 'an elegant satin evening hijab with graceful glossy draping around the face and neckline',
  },
];

export const hijabColors = [
  { name: 'أسود', value: '#22201f', prompt: 'black' },
  { name: 'عاجي', value: '#efe6d8', prompt: 'ivory' },
  { name: 'بيج', value: '#cdb293', prompt: 'beige' },
  { name: 'وردي ناعم', value: '#dcb1b3', prompt: 'dusty rose' },
  { name: 'عنابي', value: '#6e2a3c', prompt: 'burgundy' },
  { name: 'زيتي', value: '#6a6f4c', prompt: 'olive green' },
  { name: 'كحلي', value: '#27324d', prompt: 'navy blue' },
  { name: 'رمادي', value: '#8d8c90', prompt: 'soft grey' },
];

export const makeupPresets = [
  { id: 'soft', name: 'وردي ناعم', colors: ['#e9b8b0', '#ce8895', '#ab727c'] },
  { id: 'warm', name: 'درجات دافئة', colors: ['#e3bd91', '#c18c68', '#9b5c4c'] },
  { id: 'evening', name: 'مكياج سهرة', colors: ['#bea1aa', '#936576', '#723e58'] },
];

export const makeupStrengths = {
  ناعم: 'very light and natural, sheer colors, minimal eyeshadow',
  متوسط: 'moderate, blended and balanced',
  بارز: 'bold and defined',
};

export const maxLookItems = 8;

export const defaultLook = () => ({
  itemIds: [],
  hair: 'waves',
  color: 'بني داكن',
  hijabWrap: 'classic',
  hijabColor: 'بيج',
  makeup: 'soft',
  strength: 'ناعم',
  lip: '#ab727c',
  eye: '#ce8895',
  blush: '#e9b8b0',
});

export const lookKeys = Object.keys(defaultLook());

export const wearsHijab = (profile) => profile?.hijabStyle === 'hijab';
export const prefersModest = (profile) => wearsHijab(profile) || profile?.modesty === 'modest';

/** Which catalog items a given occasion source ("all" | "wardrobe" | "catalog") allows. */
export const matchesSource = (item, source) =>
  !source ||
  source === 'all' ||
  (source === 'wardrobe' ? item.source === 'wardrobe' : item.source !== 'wardrobe');
