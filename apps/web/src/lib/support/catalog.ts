// Port af app_support.py: butikker, kategorier, underkategorier,
// unify_category, ikke-mad/tobak/øko/laktose og vægt-/stk-parsing.
import { B_END, B_START, D, W, WS_CLASS, cpLen, pyFloat, pyInt, pyStr, pyStrip, pyTruthy, reEscape } from './py'

// ── Butikker ────────────────────────────────────────────────────────────────
export interface StoreConfig {
  db_key: string | null
  label: string
  logo: string
}

/** _STORE_CONFIGS (indsættelsesrækkefølge = Python-dict'ens). */
export const STORE_CONFIGS: Readonly<Record<string, StoreConfig>> = {
  rema: { db_key: null, label: 'Rema 1000', logo: '/static/images/Rema1000-logo.png' },
  bilka: { db_key: 'Bilka', label: 'Bilka', logo: '/static/images/bilka-logo.png' },
  netto: { db_key: 'Netto', label: 'Netto', logo: '/static/images/netto-logo.png' },
  foetex: { db_key: 'Foetex', label: 'Føtex', logo: '/static/images/foetex-logo.png' },
  mk: { db_key: 'minkøbmand', label: 'Min Købmand', logo: '/static/images/Min_kobmand_logo.png' },
  meny: { db_key: 'Meny', label: 'Meny', logo: '/static/images/meny-logo.png' },
  spar: { db_key: 'Spar', label: 'Spar', logo: '/static/images/spar-logo.png' },
  sb: { db_key: 'SuperBrugsen', label: 'SuperBrugsen', logo: '/static/images/superbrugsen-logo.png' },
  brugsen: { db_key: 'Brugsen', label: 'Brugsen', logo: '/static/images/brugsen-logo.png' },
  kvickly: { db_key: 'Kvickly', label: 'Kvickly', logo: '/static/images/kvickly-logo.png' },
  discount365: { db_key: '365discount', label: '365 Discount', logo: '/static/images/365discount-logo.png' },
  lidl: { db_key: 'Lidl', label: 'Lidl', logo: '/static/images/lidl-logo.png' },
  loevbjerg: { db_key: 'Løvbjerg', label: 'Løvbjerg', logo: '/static/images/loevbjerg-logo.png' },
  abclavpris: { db_key: 'ABC Lavpris', label: 'ABC Lavpris', logo: '/static/images/abc-lavpris-logo.png' },
}

/** _STORE_CONFIGS.get(key, {}).get('label') */
export function storeLabel(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(STORE_CONFIGS, key) ? STORE_CONFIGS[key].label : null
}

export const STORE_CATALOG_VERSION = 3
export const STORES_ADDED_IN_VERSION: Readonly<Record<number, readonly string[]>> = {
  2: ['Lidl'],
  3: ['Løvbjerg', 'ABC Lavpris'],
}

/** stores_auto_enable_since */
export function storesAutoEnableSince(savedVersion: number): string[] {
  const labels: string[] = []
  for (let ver = savedVersion + 1; ver <= STORE_CATALOG_VERSION; ver++) {
    labels.push(...(STORES_ADDED_IN_VERSION[ver] ?? []))
  }
  return labels
}

/** _PLACEHOLDER_IMGS */
export const PLACEHOLDER_IMGS: ReadonlySet<string> = new Set([
  '/static/images/bilka-logo.png',
  '/static/images/Min_kobmand_logo.png',
  '/static/images/meny-logo.png',
  '/static/images/spar-logo.png',
  '/static/images/Rema1000-logo.png',
  'https://rema-product-images.digital.rema1000.dk/521365/1-large-bJ9YdpX0qL.webp',
  'https://rema-product-images.digital.rema1000.dk/521363/1-large-rDq68WajPb.webp',
  'https://rema-product-images.digital.rema1000.dk/521374/1-large-869DBK5MoM.webp',
])

// ── Kategorier ──────────────────────────────────────────────────────────────
export const CAT_MEJERI = 'Køl'
export const CAT_KOED_FISK = 'Kød & Fisk'
export const CAT_FRUGT_GROENT = 'Frugt & Grønt'
export const CAT_BROED_KAGER = 'Brød & Kager'
export const CAT_FROST = 'Frost'
export const CAT_KOLONIAL = 'Kolonial'
export const CAT_DRIKKEVARER = 'Drikkevarer'
export const CAT_SLIK = 'Slik'
export const CAT_ANDET = 'Andre varer'

// Lister genereret direkte fra app_support.py (_BLOCKED_NAME_FRAGMENTS og
// _EXTRA_NON_FOOD_TERMS er sets i Python - rækkefølgen er her sorteret).
export const BLOCKED_NAME_FRAGMENTS: readonly string[] = ["7 tv dage", "7 tv-dage", "7-tv-dage", "airfryer", "alminox", "alt for damerne", "anders and", "ansigtscreme", "apotek", "aspirin", "babybad", "babycreme", "babylove", "babyvask", "badeklæde", "balsam", "batteri", "bellman", "billed bladet", "billedbladet", "bind", "ble", "blebukse", "blebukser", "bleer", "bleposer", "bloklys", "blomst", "blomster", "blomsterjord", "blød pakke", "bodycreme", "bref", "brusegel", "buket", "børnecreme", "camel", "cecil original", "chesterfield", "cigar", "cigaret", "cigaretter", "cigarillo", "dagcreme", "deodorant", "deospray", "domestos", "dreamies", "dyne", "ekstra bladet", "elkedel", "escort blå", "escort gul", "espressomaskine", "febernedsættende", "felix", "fodcreme", "forbinding", "fugemasse", "fugtighedscreme", "fyrfadslys", "fyrstikker", "gauloises", "gyngestol", "gødning", "hardbox", "harpic", "havebord", "havejord", "havemøbel", "havemøbler", "havestol", "hendes verden", "her og nu", "hjemmesko", "hjemmet", "hostesaft", "house of prince", "hudcreme", "hudpleje", "huggies", "hundemad", "hundesnack", "håndcreme", "håndsæbe", "hælecreme", "ibumetin", "ibuprofen", "imodium", "indlæg", "ipren", "kaffemaskine", "kasket", "kattefoder", "kattegrus", "kattemad", "king's", "klapstol", "kodimagnyl", "kompres", "kosttilskud", "kridt", "kronelys", "krukke", "krysantemum", "køkken rulle", "køkkenrulle", "l&m", "leggings", "libero", "liggestol", "lighter", "lotion", "lucky strike", "lænestol", "magasin", "magnyl", "makeupfjerner", "maler", "malersæt", "maling", "manitou", "marlboro", "mascara", "medicin", "natcreme", "neglelak", "nikotin", "nissehave", "næsespray", "opvaskemiddel", "opvasketabs", "original blend no", "orkidé", "pall mall", "pamol", "pampers", "panodil", "paracetamol", "parasol", "parfume", "pedigree", "pensel", "penselsæt", "piberensere", "pinex", "plante", "plantejord", "planter", "plaster", "potte", "pottejord", "pottemuld", "potteplante", "potteplanter", "potteskjuler", "prince blå", "prince filter", "prince grå", "prince rød", "prince røg", "proteinpulver", "pude", "purina", "roser", "royal canin", "se og hør", "sengetæppe", "sengetøj", "shampoo", "shower gel", "silikone", "skifteunderlag", "skjold blå", "skjold grå", "skjold rød", "skumvaskeklud", "skyllemiddel", "slipper", "smertestillende", "sneakers", "snus", "sofabord", "softbox", "softpack", "solbriller", "solcreme", "sollotion", "spagnum", "spartel", "spartelmasse", "spisebord", "spisebordsstol", "stearinlys", "stegepande", "støvsuger", "støvsugerpose", "sutteflaske", "sårpleje", "søndag", "t-shirt", "tabletter børn", "tabletter mod", "tampon", "tandbørste", "tandpasta", "tapet", "telt", "tigerbrand", "tobak", "toilet", "toiletpapir", "toiletrengøring", "treo", "trolley", "tulipaner", "tændstik", "ude & hjemme", "ude og hjemme", "ugeblad", "uneflex", "vaskekapsler", "vaskemiddel", "vaskeserviet", "viking blå", "viking grå", "viking rød", "virg blend", "virginia blend", "vitaminer", "vådligger", "vådliggerlagner", "vådserviet", "whey protein", "whiskas", "winston", "zapp elektron", "zinkcreme", "øjencreme", "øjendråber", "øjenråber"]

export const EXTRA_NON_FOOD_TERMS: readonly string[] = ["affaldsposer", "afkalker", "afspændingsmiddel", "airpods", "alufolie", "badehåndklæde", "bagepapir", "barberblade", "barberskum", "batterier", "bodylotion", "bærbar", "c-vitamin", "collagen", "d-vitamin", "deo", "doro", "dyrefoder", "dyremad", "earbuds", "engangsservice", "febernedsættende", "fiskeolie", "fjernsyn", "friskies", "fryseposer", "glødepære", "hisense", "hovedtelefoner", "huawei", "hundefoder", "hundelegetøj", "husholdningsfilm", "håndklæde", "højttaler", "høretelefon", "høretelefoner", "iams", "ibumetin", "ibuprofen", "imodium", "intimsæbe", "ipad", "iphone", "ipod", "ipren", "kamera", "karklud", "karklude", "kattebakke", "kattemøbel", "kattesand", "kreatin", "kæledyrsfoder", "laptop", "legetøj", "lg", "lommetørklæder", "lyspære", "macbook", "magnesium", "mobiltelefon", "multivitamin", "mundskyl", "nintendo", "oled", "oneplus", "opladelige", "oplader", "overvågningskamera", "pamol", "panodil", "paptallerken", "paracetamol", "plastikkrus", "playstation", "pletfjerner", "powerbank", "printer", "prosonic", "puslespil", "qled", "rengøringsmiddel", "router", "samsung", "servietter", "sheba", "skraldeposer", "skuresvamp", "smart tv", "smartphone", "smartwatch", "smertestillende", "sokker", "sololie", "solspray", "solstift", "soundbar", "spil", "strømper", "sæbe", "sæbespåner", "tandtråd", "tcl", "telefon", "toiletrens", "tp-link", "tøjvask", "tørrestativ", "undertøj", "vatpinde", "vatrondeller", "videokamera", "viskestykke", "viskestykker", "vitamintilskud", "wc-rens", "webcam", "xbox", "xiaomi", "zte", "øretelefoner"]

export const SUBCATEGORY_RULES: Readonly<Record<string, ReadonlyArray<readonly [string, readonly string[]]>>> = {"Drikkevarer": [["Øl & Cider", [" øl", "øl ", "pilsner", "lager", " ale ", "ipa", "stout", "porter", "cider", "radler", "breezer", "pils "]], ["Vin & Spiritus", ["hvidvin", "rødvin", "rosé", "prosecco", "champagne", "cava", "sangria", "whisky", "whiskey", "vodka", " gin ", " rom ", "tequila", "likør", "akvavit", "spiritus", "cognac", "brandy", "cointreau", "baileys", " vin ", "vin,"]], ["Kaffe & Te", ["kaffe", "espresso", "cappuccino", "kaffekapsler", "nespresso", " te ", "te,", "tebreve", "chai", "urtete", "grøn te", "matcha"]], ["Juice & Smoothie", ["juice", "smoothie", "nektar", "frugtdrik", "kokosvand"]], ["Saft & Sirup", ["saft", "sirup", "squash", "koncentrat"]], ["Vand", ["mineralvand", "kildevand", "danskvand", " vand", "vand "]], ["Sodavand & Energi", ["cola", "sodavand", "energidrik", "energy drink", "sportsdrik", "red bull", "redbull", "monster ", "iste", "ice tea", "lemonade", "tonic", "kombucha"]]], "Køl": [["Mælk & Fløde", ["mælk", "fløde", "halvfløde", "kærnemælk", "kefir", "havremælk", "mandelmælk", "sojamælk", "rismælk"]], ["Yoghurt & Kvark", ["yoghurt", "skyr", "kvark", "ymer", "fromage", "fraiche", "creme fraiche"]], ["Ost", [" ost", "ost ", "ost,", "brie", "camembert", "gouda", "cheddar", "parmesan", "fetaost", "feta", "mozzarella", "ricotta", "hytteost", "danbo", "esrom", "castello"]], ["Smør & Fedtstof", ["smør", "margarine", "plantesmør", "bregott", "lurpak"]], ["Pålæg & Kølvarer", ["pålæg", "leverpostej", "postej", "skinke", "salami", "rullepølse", "spegepølse", "mortadella", "roastbeef", "paté", "pølse", "hummus"]], ["Æg", ["æg"]]], "Kød & Fisk": [["Oksekød & Kalv", ["okse", "kalv", "oksekød", "entrecôte", "ribeye", "mørbrad", "cuvette", "oksesteg", "tyksteg"]], ["Svinekød", ["svin", "svinekød", "nakkefilet", "koteletter", "flæsk", "bacon", "ribbensteg", "svinesteg", "svinemørbrad"]], ["Fjerkræ", ["kylling", "kalkun", "and ", "ande", "poussin"]], ["Lam & Vildt", ["lam", "lammekød", "vildt", "hjort", "rådyr", "kanin"]], ["Fisk & Skaldyr", ["fisk", "laks", "torsk", "tun", "makrel", "sild", "rejer", "muslinger", "krabbe", "blæksprutte", "rødspætte", "tilapia", "pangasius", "sei", "kuller", "ørred", "aborre", "helleflynder", "hornfisk"]], ["Pølser", ["pølse", "medister", "grillpølse", "hotdog", "chorizo", "pepperoni"]]], "Frugt & Grønt": [["Frugt", ["æble", "pære", "banan", "appelsin", "citron", "lime", "grape", "melon", "jordbær", "hindbær", "blåbær", "mango", "ananas", "kiwi", "fersken", "nektarin", "blomme", "kirsebær", "druer", "avocado", "kokos", "papaya", "klementin", "mandarin", "granatæble"]], ["Grøntsager", ["salat", "spinat", "grønkål", "hvidkål", "rødkål", "broccoli", "blomkål", "gulerod", "løg", "kartofler", "tomat", "agurk", "peberfrugt", "zucchini", "aubergine", "selleri", "fennikel", "porrer", "asparges", "roer", "radiser", "majs", "ærter", "bønner", "pastinak", "rucola"]], ["Svampe", ["champignon", "svampe", "shiitake", "portobello", "østershat"]], ["Krydderurter", ["basilikum", "persille", "koriander", "rosmarin", "timian", "mynte", "estragon", "oregano", "dild", "purløg", "salvie"]]], "Brød & Kager": [["Rugbrød & Knækbrød", ["rugbrød", "knækbrød", "rugmel"]], ["Brød", ["franskbrød", "toastbrød", "sandwichbrød", "ciabatta", "surdejsbrød", "fuldkornsbrød", "baguette", "flutes", "pita", "focaccia", "brød"]], ["Boller", ["boller", "rundstykker", "burgerboller", "miniboller"]], ["Kager & Wienerbrød", ["kage", "wienerbrød", "croissant", "kanelsneglen", "tebirkes", "spandauer", "muffin", "tærte", "lagkage", "brownie", "cheesecake", "romkugle"]], ["Kiks & Vafler", ["kiks", "crackers", "vafler", "riskager", "digestive"]], ["Bagning", ["mel", "hvedemel", "gær", "bagepulver", "natron", "majsstivelse"]]], "Frost": [["Is & Desserter", ["is", "flødeis", "mælkeis", "sorbetis", "ispinde", "islagkage", "dessert", "tiramisu", "macarons", "fondant", "æbleskiver"]], ["Frossen Fisk", ["fisk", "rejer", "laks", "torsk", "rødspætte", "sei", "pangasius", "tilapia", "fiskepinde", "panerede", "tempura"]], ["Frossen Kød", ["kød", "kylling", "burger", "bøf", "frikadeller", "kødboller", "karbonader", "hakket", "pølse", "medister"]], ["Frossen Grønt & Frugt", ["ærter", "majs", "broccoli", "spinat", "bønner", "grøntsags", "edamame", "mukimame", "blåbær", "jordbær", "hindbær", "brombær"]], ["Frost Brød", ["brød", "boller", "baguette", "croissant", "tebirkes", "bagels", "focaccia"]], ["Færdigretter", ["lasagne", "pizza", "tikka masala", "butter chicken", "boller i karry", "spaghetti bolognese", "karbonade", "risotto", "wok", "gratin"]]], "Kolonial": [["Pasta & Ris", ["pasta", "spaghetti", "penne", "fusilli", "rigatoni", "lasagne plader", "tagliatelle", "fettuccine", "nudler", "macaroni", "couscous", "quinoa", "bulgur", "polenta", "basmati", "jasminris", "risotto", " ris "]], ["Konserves & Dåse", ["dåse", "konserves", "kikærter", "linser", "kidneybønner", "hvidebønner", "flåede tomater", "tomatpuré", "rødbeder", "sylte", "syltede", "majs", "asparges", "champignon", "artiskok", "dåseoliven", " oliven ", "sardiner", "tun i ", "makrel i ", "ansjoser"]], ["Morgenmad", ["havregryn", "müsli", "granola", "cornflakes", "morgenmad", "grød", "chiafrø", "hørfrø", "fiberhusk"]], ["Krydderier & Sauce", ["krydderi", " salt ", "peber", "chili", "paprika", "karry", "sauce", "ketchup", "sennep", "mayonnaise", "dressing", "bouillon", "fond", "soyasauce", "pesto", "sambal", "tabasco", "teriyaki"]], ["Olie & Eddike", ["olie", "olivenolie", "rapsolie", "solsikkeolie", "eddike", "balsamico"]], ["Nødder & Tørret Frugt", ["nødder", "mandler", "cashew", "valnødder", "hasselnødder", "pistacier", "jordnødder", "rosiner", "dadler", "tørrede"]], ["Bagning & Sødning", ["mel ", "sukker", "melis", "bagepulver", "vanilje", "honning", "marmelade", "syltetøj", "nutella", "peanutbutter", "kakao", "sødetabl", "sødemiddel", "stevia", "sukrinol", "canderel"]], ["Supper & Snacks", ["suppe", "suppefond", "popcorn", "chips", "nachos", "kiks", "cracker"]]], "Slik": [["Chokolade", ["chokolade", "praliner", "trøfler", "bounty", "snickers", "twix", "kit kat", "mars", "milka", "toblerone", "ferrero"]], ["Slik & Vingummi", ["vingummi", "lakrids", "skumfiduser", "bolsjer", "karameller", "gummi", "haribo", "pastiller", "tyggegummi", "guf", "skum"]], ["Chips & Snacks", ["chips", "popcorn", "nachos", "majschips", "tortillachips", "linsechips", "jordnøddesnack"]], ["Proteinbarer", ["proteinbar", "energibar", "müslibar", "snackbar", "protein"]]]}

export const BILKA_CATEGORY_RULES: ReadonlyArray<readonly [string, readonly string[]]> = [["Drikkevarer", ["cola", "sodavand", "juice", "energidrik", "øl", "vin", "spiritus", "smoothie", "vand", "saft", "cider", "whisky", "vodka", "gin", "rom", "tequila", "likør", "akvavit", "champagne", "prosecco", "cava", "iste", "sportsdrik", "ingefærshot", "kombucha", "kokosvand", "shots", "frugtdrik", "blanding", "sirup", "drik", "lemonade", "breezer", "smirnoff", "sangria", "hvidvin", "rødvin", "rosévin", "pilsner", "bitter", "tonic"]], ["Frost", ["pommes frites", "kyllingenuggets", "frikadeller", "flødeis", "mælkeis", "sorbetis", "ispinde", "isvafler", "pizza m.", "fuldkornsboller", "håndværkere", "miniflutes", "croissanter", "pain au chocolat", "kanelsnegle", "tebirkes", "surdejsstykker", "baguettes", "focaccia m.", "boller m.", "bagels", "grøntsagsblanding", "bærblanding", "blåbær", "jordbær", "hindbær", "brombær", "frys-selv", "frossen", "mukimame", "edamame", "kartoffelriste", "kartoffelkroketter", "løgringe", "fiskepinde", "panerede", "rejenuggets", "tempurarejer", "butterfly rejer", "vannamei rejer", "grønlandske rejer", "dumplings", "gyoza", "forårsruller", "samosa", "falafler", "kødboller", "melboller", "karbonader", "burgerbøffer", "tikka masala m.", "butter chicken m.", "lasagne bolognese", "spaghetti bolognese", "karbonade m.", "boller i karry m. ris", "kylling i", "flødeisvafler", "mælkeis sandwich", "limonadeis", "islagkage", "chokoladefondant", "tiramisu", "æbleskiver", "æbleskiver m.", "æblekage", "skovbærtærte", "citrontærte", "cheesecake 2 stk", "sacher 2 stk", "tærte", "macarons", "pølsehorn", "møllehjul", "astronautis", "carte d'or"]], ["Slik", ["chips m.", "majschips", "linsechips", "rodfrugtchips", "popcorn", "skumfiduser", "vingummi", "lakrids", "chokoladebar", "mælkechokolade", "mørk chokolade", "hvid chokolade", "karameller", "bolcher", "pastiller", "tyggegummi", "müslibar", "frugtsnacks", "frugtstænger", "rosiner", "nøddeblanding", "peanuts", "flæskesvær", "saltsnacks", "saltstænger", "marcipanbrød", "vingummibamser", "skumbananer", "ostepops", "dipmix", "click mix", "matador mix", "stjerne mix", "favorit mix", "beef jerky", "tørret mango", "tørrede", "rawbar", "daddelbar", "müslibarer", "chokoladekugler", "lakridsstænger", "chips", "osterejer", "blandede chokolader"]], ["Brød & Kager", ["rugbrød", "toastbrød", "sandwichbrød", "burgerboller", "hotdogbrød", "pølsebrød", "baguette", "pitabrød", "naanbrød", "knækbrød", "digestive kiks", "mariekiks", "havrekiks", "kiks m.", "cookies m.", "kiks", "lu prince", "fuldkornsboller", "solsikkeboller", "rugboller", "sandwichboller", "hvedeboller", "yoghurtboller", "krydderboller", "surdejsbrød", "focaccia", "ciabatta", "grissini", "rasp", "tarteletter", "lagkagebunde", "tærtebund", "vafler", "isvafler", "bondebrød", "schwarzbrot", "fladbrød", "tortillas", "tortillachips", "pitabrød", "fastelavnsbolle", "boller", "brød", "bagels", "citronmåne", "romkugler", "drømmekage", "kanelstang", "daim mini", "mazarinkager", "kammerjunkere", "brownie", "muffins", "chokoladekage", "citronkage", "marmorkage", "sandkage", "gulerodskage", "hindbærroulade", "roulade", "vaniljekranse", "honningsnitter", "småkager", "tvebakker", "pumpernickel", "grovboller", "proteinboller", "proteinbrød", "gulerodsboller", "fuldkornssandwichbrød", "skagensbrød", "brioche", "pølsehornsdej", "pizzadej", "butterdej", "croissantdej", "tærtedej", "fuldkornspizzabunde", "surdejspizzadej", "surdejsboller"]], ["Køl", ["mælk", "smør", "piskefløde", "skyr", "yoghurt", "kefir", "fraiche", "creme fraiche", "kærnemælk", "ymer", "bagegær", "æg", "havredrik", "sojadrik", "mandeldrik", "risdrik", "oatly", "flydende til madlavning", "stegemargarine", "plantemargarine", "smørbar", "danbo", "havarti", "cheddar", "mozzarella", "brie", "camembert", "feta", "gorgonzola", "emmentaler", "gouda", "ricotta", "mascarpone", "burrata", "parmesan", "parmigiano", "grana padano", "pecorino", "manchego", "jarlsberg", "samsø ost", "danablu", "blåskimmelost", "rygeost", "smøreost", "flødeost", "ostehaps", "ostetern", "salatost", "hytteost", "halloumi", "gruyere", "comté", "port salut", "præst", "rødkitost"]], ["Kolonial", ["pasta", "ris", "mel", "sukker", "olie", "sauce", "ketchup", "marmelade", "konserves", "havregryn", "müsli", "musli", "granola", "bouillon", "krydderi", "sennep", "mayonnaise", "remoulade", "dressing", "tun i", "makrel i", "sardiner", "oliven", "kapers", "pesto", "tomatsauce", "passata", "hakkede tomater", "tomatpuré", "pizzasauce", "bechamelsauce", "hollandaise", "bearnaisesauce", "honning", "sirup", "eddike", "cornflakes", "frosties", "coco pops", "cheerios", "havrefras", "fiberknas", "guldkorn", "risottoris", "basmatiris", "jasminris", "parboiled", "fusilli", "spaghetti", "penne", "lasagneplader", "tagliatelle", "gnocchi", "instant kaffe", "formalet kaffe", "hele bønner", "kaffekapsler", "te", "bagepulver", "vaniljesukker", "chiafrø", "hørfrø", "solsikkekerner", "valnødder", "cashewnødder", "mandler", "pinjekerner", "pistaciekerner", "kokosmel", "kokosmælk", "sojasauce", "woksauce", "tortillas", "tacosauce", "tortillachips", "nudler", "risnudler", "hvedenudler", "glasnudler", "chilisauce", "teriyaki", "boller i karry", "lasagne", "spaghetti bolognese", "pasta carbonara", "burger", "frokostplatte", "kylling tikka masala", "tikka masala", "butter chicken", "tarteletfyld", "biksemad", "millionbøf", "flæskestegsburger", "schnitzel m. tilbehør", "karbonader m.", "frikadeller m.", "hakkebøffer m.", "kartoffelmos m.", "boller i karry m.", "kylling i karry", "kylling i rød", "kylling m. ris", "pasta m. kylling", "pasta bolognese", "mørbradgryde", "paprikagryde", "goulash", "forloren hare", "wienergryde", "jægergryde", "gyros m.", "kyllingewok", "ris m. kylling", "risotto m."]], ["Frugt & Grønt", ["agurk", "bananer", "banan", "peberfrugt", "tomat", "gulerødder", "gulerod", "salat", "broccoli", "blomkål", "æbler", "æble", "pærer", "pære", "appelsin", "citron", "jordbær", "hindbær", "kål", "rødkål", "hvidkål", "spidskål", "løg", "rødløg", "forårsløg", "kartofler", "kartoffel", "squash", "avocado", "spinat", "svampe", "champignon", "melon", "druer", "mango", "ananas", "blåbær", "brombær", "solbær", "tranebær", "klementiner", "kiwi", "lime", "citrongræs", "ingefær", "hvidløg", "purløg", "persille", "dild", "basilikum", "rosmarin", "timian", "asparges", "artiskok", "selleri", "pastinak", "persillerod", "rødbeder", "jordskokkerne", "aubergine", "courgette", "rosenkål", "grønkål", "rucola", "feldsalat", "icebergsalat", "romainesalat", "pak choi", "sugarsnaps", "ærter", "bobbybønner", "sukkerærter", "vandmelon", "papaya", "dadler", "figner", "granatæble", "coconut", "passionsfrugt", "mandariner", "klementiner", "nektariner", "abrikoser", "blomme", "kirsebær", "vindruer", "hokkaido", "butternut"]]]

/** _get_subcategory */
export function getSubcategory(name: string, category: string): string {
  const rules = Object.prototype.hasOwnProperty.call(SUBCATEGORY_RULES, category) ? SUBCATEGORY_RULES[category] : null
  if (!rules || !rules.length) return ''
  const nameLower = name.toLowerCase()
  for (const [sub, keywords] of rules) {
    if (keywords.some((kw) => nameLower.includes(kw))) return sub
  }
  return 'Øvrige'
}

// ── Ikke-mad ────────────────────────────────────────────────────────────────
const NON_FOOD_SUFFIX_TERMS = ['maling', 'shampoo']
const byLenDesc = (a: string, b: string) => cpLen(b) - cpLen(a)
const NON_FOOD_BOTH_ANCHOR = [...new Set([...BLOCKED_NAME_FRAGMENTS, ...EXTRA_NON_FOOD_TERMS])]
  .filter((t) => !NON_FOOD_SUFFIX_TERMS.includes(t))
  .sort(byLenDesc)

/** _NON_FOOD_NAME_RE */
export const NON_FOOD_NAME_RE = new RegExp(
  '(?<![0-9a-zæøåäöü])(?:' +
    NON_FOOD_BOTH_ANCHOR.map(reEscape).join('|') +
    ')(?![0-9a-zæøåäöü])|(?:' +
    [...NON_FOOD_SUFFIX_TERMS].sort(byLenDesc).map(reEscape).join('|') +
    ')(?![0-9a-zæøåäöü])',
  'iu',
)

/** is_non_food_name */
export function isNonFoodName(name: unknown): boolean {
  return pyTruthy(name) && NON_FOOD_NAME_RE.test(pyStr(name).toLowerCase())
}

// ── Tobak ───────────────────────────────────────────────────────────────────
const REMA_TOBACCO_ID_RANGES: ReadonlyArray<readonly [number, number]> = [
  [521340, 521825],
  [561828, 561875],
]

const TOBACCO_RE = new RegExp(
  '(?<![0-9a-zæøå])(?:tobak|cigaretter|cigaret|cigarillo|cigar|snus|nikotin|e-cigaret|e-cig|' +
    'marlboro|winston|camel|pall mall|lucky strike|chesterfield|gauloises|' +
    'hardbox|softbox|softpack|blød pakke|' +
    'house of prince|virg blend|virginia blend|original blend no|' +
    'bellman|manitou|tigerbrand|escort gul|escort blå|' +
    'prince filter|prince røg|prince rød|prince grå|prince blå|' +
    'prince original 100|viking rød|viking blå|viking grå|' +
    'skjold rød|skjold blå|skjold grå|cecil original|' +
    "king's|l&m" +
    ')(?![0-9a-zæøå])',
  'iu',
)

// _LU_PRINCE_COOKIE_RE: Python's '.' matcher alt undtagen linjeskift; JS' '.' udelader flere tegn.
export const LU_PRINCE_COOKIE_RE = new RegExp(
  `${B_START}lu${B_END}[^\\n]*prince|prince[^\\n]*(?:kiks|cookie)|prince original 2-pak`,
  'iu',
)

/** is_rema_tobacco_id */
export function isRemaTobaccoId(productId: unknown): boolean {
  let pid: number
  try {
    pid = pyInt(pyStr(productId))
  } catch {
    return false
  }
  return REMA_TOBACCO_ID_RANGES.some(([lo, hi]) => lo <= pid && pid <= hi)
}

/** is_age_restricted */
export function isAgeRestricted(name: unknown = '', brand: unknown = '', _category: unknown = '', productId: unknown = ''): boolean {
  if (pyTruthy(productId) && isRemaTobaccoId(productId)) return true
  const blob = pyStrip(`${pyStr(pyTruthy(name) ? name : '')} ${pyStr(pyTruthy(brand) ? brand : '')}`).toLowerCase()
  if (!blob) return false
  if (TOBACCO_RE.test(blob)) return !LU_PRINCE_COOKIE_RE.test(blob)
  return false
}

// ── Øko / laktose ───────────────────────────────────────────────────────────
// _ORGANIC_RE = \bøkolog\w*|\bøko\b|\borganic\b
const ORGANIC_RE = new RegExp(`${B_START}økolog${W}*|${B_START}øko${B_END}|${B_START}organic${B_END}`, 'u')
const ORGANIC_NEGATED_RE = new RegExp(`${B_START}ikke${WS_CLASS}+øko`, 'u')
const LACTO_RE = new RegExp(`${B_START}lacto${B_END}`, 'u')

/** is_organic */
export function isOrganic(name: unknown, desc: unknown = '', brand: unknown = ''): boolean {
  const text = `${pyStr(name)} ${pyStr(desc)} ${pyStr(brand)}`.toLowerCase()
  if (ORGANIC_NEGATED_RE.test(text)) return false
  return ORGANIC_RE.test(text)
}

/** is_lactose_free */
export function isLactoseFree(name: unknown, desc: unknown = '', brand: unknown = ''): boolean {
  const text = `${pyStr(name)} ${pyStr(desc)} ${pyStr(brand)}`.toLowerCase()
  for (const kw of ['laktosefri', 'lactose free', 'lactose-free', 'laktose fri', 'lactofri', 'lacto-free', 'lactofree']) {
    if (text.includes(kw)) return true
  }
  return LACTO_RE.test(text)
}

// ── unify_category ──────────────────────────────────────────────────────────
/** _compile_bilka_rule: ordgrænse kun til højre. */
const BILKA_CATEGORY_RULES_COMPILED: ReadonlyArray<readonly [string, RegExp]> = BILKA_CATEGORY_RULES.map(
  ([cat, kws]) => [cat, new RegExp('(?:' + [...kws].sort(byLenDesc).map(reEscape).join('|') + ')(?![0-9a-zæøåäöü])', 'iu')] as const,
)

const KIOSK_DRINK = ['cola', 'sodavand', 'juice', 'energidrik', 'energy drink', 'øl', 'vin', 'cider', 'vand', 'saft', 'iste', 'ice tea', 'sportsdrik', 'kombucha', 'drik', 'lemonade', 'shots', 'smoothie', 'frugtdrik', 'breezer', 'kokosvand']
const KIOSK_SLIK = ['chips', 'popcorn', 'nachos', 'majschips', 'tortillachips', 'chokolade', 'slik', 'vingummi', 'lakrids', 'skumfiduser', 'bolsjer', 'karameller', 'nødder', 'jordnødder', 'guf', 'tyggegummi', ' gum', 'gum ', 'skum', 'orbit', 'stimorol', 'dirol', 'mentos', 'hubba bubba', 'wrigley']
const KIOSK_MEJERI = ['coleslaw', 'waldorf', 'hummussalat', 'pastasalat', 'kartoffelsalat', 'grøn salat', 'salat ']

const CATEGORY_MAPPING: ReadonlyMap<string, string | null> = (() => {
  const m = new Map<string, string | null>(Object.entries({
    'mejeri': CAT_MEJERI, 'mejeriprodukter & kølvarer': CAT_MEJERI,
    'pålæg og kølede middagsretter': CAT_MEJERI, 'køl': CAT_MEJERI,
    'ost': CAT_MEJERI, 'ost m.v.': CAT_MEJERI,
    'kød': CAT_KOED_FISK, 'fisk og skaldyr': CAT_KOED_FISK,
    'kød, fisk & fjerkræ': CAT_KOED_FISK, 'kød fisk fjerkræ': CAT_KOED_FISK,
    'frugt & grønt': CAT_FRUGT_GROENT, 'frugt og grønt': CAT_FRUGT_GROENT,
    'brød & kager': CAT_BROED_KAGER, 'brød og kager': CAT_BROED_KAGER,
    'brød & bavinchi': CAT_BROED_KAGER,
    'frost': CAT_FROST,
    'kolonial': CAT_KOLONIAL, 'kolonialvarer': CAT_KOLONIAL,
    'drikkevarer': CAT_DRIKKEVARER, 'vin og spiritus': CAT_DRIKKEVARER,
    'personlig pleje': null, 'pleje': null, 'husholdning': null,
    'rengøring': null, 'baby og småbørn': null,
    'kiosk': CAT_DRIKKEVARER, 'kiosk - slik og snack - chips og snacks': CAT_SLIK,
    'slik': CAT_SLIK, 'slik & snacks': CAT_SLIK, 'slik og snacks': CAT_SLIK,
    'kiosk - slik og snack - chokolade': CAT_SLIK, 'kiosk - slik og snack - slik': CAT_SLIK,
    'frugt-og-groent': CAT_FRUGT_GROENT, 'mejeri-og-koel': CAT_MEJERI,
    'slik-og-snacks': CAT_SLIK, 'broed-og-kager': CAT_BROED_KAGER,
    'koed-og-fisk': CAT_KOED_FISK, 'mad-fra-hele-verden': CAT_KOLONIAL,
    'ispinde-og-sodavandsis': CAT_FROST, 'is-i-baeger': CAT_FROST,
    'frys-selv-is': CAT_FROST, 'isvafler': CAT_FROST,
    'desserter-og-islagkager': CAT_FROST, 'groentsager': CAT_FROST,
    'faerdigretter-paa-frost': CAT_FROST, 'frugt-og-baer': CAT_FROST,
    'kartofler-og-pommes-frites': CAT_FROST,
    'avis': CAT_ANDET,
  }))
  // Idempotens: kanoniske navne mapper til sig selv (setdefault).
  for (const c of [CAT_MEJERI, CAT_KOED_FISK, CAT_FRUGT_GROENT, CAT_BROED_KAGER, CAT_FROST, CAT_KOLONIAL, CAT_DRIKKEVARER, CAT_SLIK, CAT_ANDET]) {
    if (!m.has(c.toLowerCase())) m.set(c.toLowerCase(), c)
  }
  return m
})()

/** unify_category: standardkategori, eller null hvis varen ikke er mad. */
export function unifyCategory(rawCat: unknown, productName: unknown = '', brand: unknown = ''): string | null {
  const raw = pyStrip(pyStr(pyTruthy(rawCat) ? rawCat : '').toLowerCase())
  const name = pyStrip(pyStr(pyTruthy(productName) ? productName : '').toLowerCase())
  const brandS = pyStrip(pyStr(pyTruthy(brand) ? brand : ''))

  if (isAgeRestricted(productName, brandS, rawCat)) return null

  if (
    name.includes('prince') &&
    (name.includes('kiks') || name.includes('lu') || name.includes('cookie') || name.includes('chokolade') ||
      name.includes('creme') || LU_PRINCE_COOKIE_RE.test(name))
  ) {
    return CAT_BROED_KAGER
  }

  if (name && NON_FOOD_NAME_RE.test(name)) return null
  if (brandS && NON_FOOD_NAME_RE.test(brandS.toLowerCase())) {
    if (!LU_PRINCE_COOKIE_RE.test(`${name} ${brandS}`.toLowerCase())) return null
  }

  if (name.includes('lolly') || name.includes('frys-selv') || name.includes('ispind')) return CAT_FROST

  if (raw.includes('kiosk') && name) {
    if (KIOSK_DRINK.some((kw) => name.includes(kw))) return CAT_DRIKKEVARER
    if (KIOSK_SLIK.some((kw) => name.includes(kw))) return CAT_SLIK
    if (KIOSK_MEJERI.some((kw) => name.includes(kw))) return CAT_MEJERI
  }

  if (CATEGORY_MAPPING.has(raw)) return CATEGORY_MAPPING.get(raw)!
  for (const [cat, pattern] of BILKA_CATEGORY_RULES_COMPILED) {
    if (pattern.test(name)) return cat
  }
  return raw ? CAT_KOLONIAL : CAT_ANDET
}

// ── Vægt / stk ──────────────────────────────────────────────────────────────
const S = `${WS_CLASS}*`
const WEIGHT_RE = new RegExp(`^([${D}.]+)${S}([a-zæøå]+)$`, 'u')
const MULTIPACK_RE = new RegExp(`^(${D}+)${S}x${S}([${D}.]+)${S}([a-zæøå]+)\\.?$`, 'u')
const STK_RE = new RegExp(`^([${D}.]+)${S}st[k]?$`, 'u')

/** _unit_to_grams */
export function unitToGrams(value: number, unit: string): number | null {
  if (unit === 'g' || unit === 'gr' || unit === 'gram') return value
  if (unit === 'kg') return value * 1000
  if (unit === 'l' || unit === 'ltr' || unit === 'liter' || unit === 'litre') return value * 1000
  if (unit === 'ml') return value
  if (unit === 'cl') return value * 10
  if (unit === 'dl') return value * 100
  return null
}

function emptyWeight(v: unknown): boolean {
  return !pyTruthy(v) || ['nan', '', 'none'].includes(pyStrip(pyStr(v)).toLowerCase())
}

/** parse_weight_to_grams */
export function parseWeightToGrams(weightStr: unknown): number | null {
  if (emptyWeight(weightStr)) return null
  const s = pyStrip(pyStr(weightStr)).toLowerCase().replaceAll(',', '.')
  let m = MULTIPACK_RE.exec(s)
  if (m) {
    let count: number
    let value: number
    try {
      count = pyInt(m[1])
      value = pyFloat(m[2])
    } catch {
      return null
    }
    const unitG = unitToGrams(value, m[3])
    return unitG !== null && count > 0 ? count * unitG : null
  }
  m = WEIGHT_RE.exec(s)
  if (!m) return null
  let value: number
  try {
    value = pyFloat(m[1])
  } catch {
    return null
  }
  return unitToGrams(value, m[2])
}

/** parse_stk_count */
export function parseStkCount(weightStr: unknown): number | null {
  if (emptyWeight(weightStr)) return null
  const s = pyStrip(pyStr(weightStr)).toLowerCase().replaceAll(',', '.')
  const m = STK_RE.exec(s)
  if (!m) return null
  try {
    return pyInt(pyFloat(m[1]))
  } catch {
    return null
  }
}
