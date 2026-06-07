/**
 * Mapping of display cuisine labels to Google Places type values.
 * The backend validates these labels and turns them into Places filters.
 */
const CUISINES = {
  'Italian':        ['italian_restaurant', 'pizza_restaurant'],
  'French':         ['french_restaurant', 'bistro'],
  'Spanish':        ['spanish_restaurant', 'tapas_restaurant'],
  'Greek':          ['greek_restaurant'],
  'Japanese':       ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant', 'japanese_curry_restaurant'],
  'Chinese':        ['chinese_restaurant', 'chinese_noodle_restaurant', 'dim_sum_restaurant'],
  'Thai':           ['thai_restaurant'],
  'Indian':         ['indian_restaurant', 'north_indian_restaurant', 'south_indian_restaurant'],
  'Vietnamese':     ['vietnamese_restaurant'],
  'Korean':         ['korean_restaurant', 'korean_barbecue_restaurant'],
  'Mexican':        ['mexican_restaurant', 'taco_restaurant', 'burrito_restaurant', 'tex_mex_restaurant'],
  'Middle Eastern': ['middle_eastern_restaurant', 'mediterranean_restaurant', 'lebanese_restaurant', 'turkish_restaurant', 'kebab_shop', 'falafel_restaurant', 'halal_restaurant'],
  'American':       ['american_restaurant', 'hamburger_restaurant', 'steak_house', 'barbecue_restaurant'],
  'Seafood':        ['seafood_restaurant', 'fish_and_chips_restaurant', 'oyster_bar_restaurant'],
  'Vegetarian':     ['vegetarian_restaurant', 'vegan_restaurant', 'salad_shop'],
  'Café / Brunch':  ['cafe', 'coffee_shop', 'breakfast_restaurant', 'brunch_restaurant', 'bagel_shop'],
  'Bakery / Sweets':['bakery', 'dessert_shop', 'dessert_restaurant', 'ice_cream_shop', 'cake_shop', 'pastry_shop'],
  'Pub / Bar':      ['pub', 'bar', 'bar_and_grill', 'gastropub', 'sports_bar', 'wine_bar', 'cocktail_bar']
};
