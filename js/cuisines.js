/**
 * Mapping of display cuisine labels → OSM `cuisine` tag values.
 * OSM's tagging is fragmented; this groups common variants into
 * user-friendly categories.
 */
const CUISINES = {
  'Italian':        ['italian', 'pizza', 'pasta'],
  'French':         ['french'],
  'Spanish':        ['spanish', 'tapas'],
  'Greek':          ['greek'],
  'Japanese':       ['japanese', 'sushi', 'ramen'],
  'Chinese':        ['chinese', 'dim_sum'],
  'Thai':           ['thai'],
  'Indian':         ['indian'],
  'Vietnamese':     ['vietnamese'],
  'Korean':         ['korean'],
  'Mexican':        ['mexican', 'tex-mex'],
  'Middle Eastern': ['lebanese', 'turkish', 'kebab', 'mediterranean'],
  'American':       ['american', 'burger', 'steak_house', 'barbecue'],
  'Seafood':        ['seafood', 'fish'],
  'Vegetarian':     ['vegetarian', 'vegan'],
  'Café / Brunch':  ['coffee_shop', 'breakfast', 'brunch', 'cafe'],
  'Bakery / Sweets':['bakery', 'dessert', 'ice_cream', 'cake'],
  'Pub / Bar':      ['pub', 'bar']
};
