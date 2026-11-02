"""O'zbekiston viloyatlari, tumanlari va viloyatga bo'ysunuvchi shaharlari. Ro'yxat shu yerda bitta:
panel va mobil ilova uni /geo/regions dan oladi. Ro'yxatda yo'q joy uchun formada qo'lda yozish bor."""
import re


def _t(*names: str) -> list[str]:
    return [f"{n} tumani" for n in names]


def _s(*names: str) -> list[str]:
    return [f"{n} shahri" for n in names]


# ISO 3166-2 kodi: OpenStreetMap javobidan viloyatni nom bo'yicha taxminsiz aniqlash uchun
REGIONS: dict[str, tuple[str, list[str]]] = {
    "UZ-TK": ("Toshkent shahri", _t(
        "Bektemir", "Chilonzor", "Mirobod", "Mirzo Ulug'bek", "Olmazor", "Sergeli", "Shayxontohur", "Uchtepa",
        "Yakkasaroy", "Yangihayot", "Yashnobod", "Yunusobod")),
    "UZ-TO": ("Toshkent viloyati", _t(
        "Bekobod", "Bo'ka", "Bo'stonliq", "Chinoz", "Ohangaron", "Oqqo'rg'on", "O'rta Chirchiq", "Parkent", "Piskent",
        "Qibray", "Quyi Chirchiq", "Yangiyo'l", "Yuqori Chirchiq", "Zangiota")
        + _s("Angren", "Bekobod", "Chirchiq", "Nurafshon", "Ohangaron", "Olmaliq", "Yangiyo'l")),
    "UZ-AN": ("Andijon viloyati", _t(
        "Andijon", "Asaka", "Baliqchi", "Bo'ston", "Buloqboshi", "Izboskan", "Jalaquduq", "Marhamat", "Oltinko'l",
        "Paxtaobod", "Qo'rg'ontepa", "Shahrixon", "Ulug'nor", "Xo'jaobod") + _s("Andijon", "Xonobod")),
    "UZ-BU": ("Buxoro viloyati", _t(
        "Buxoro", "G'ijduvon", "Jondor", "Kogon", "Olot", "Peshku", "Qorako'l", "Qorovulbozor", "Romitan", "Shofirkon",
        "Vobkent") + _s("Buxoro", "Kogon")),
    "UZ-FA": ("Farg'ona viloyati", _t(
        "Beshariq", "Bog'dod", "Buvayda", "Dang'ara", "Farg'ona", "Furqat", "Oltiariq", "O'zbekiston", "Qo'shtepa",
        "Quva", "Rishton", "So'x", "Toshloq", "Uchko'prik", "Yozyovon")
        + _s("Farg'ona", "Marg'ilon", "Qo'qon", "Quvasoy")),
    "UZ-JI": ("Jizzax viloyati", _t(
        "Arnasoy", "Baxmal", "Do'stlik", "Forish", "G'allaorol", "Mirzacho'l", "Paxtakor", "Sharof Rashidov", "Yangiobod",
        "Zafarobod", "Zarbdor", "Zomin") + _s("Jizzax")),
    "UZ-NG": ("Namangan viloyati", _t(
        "Chortoq", "Chust", "Kosonsoy", "Mingbuloq", "Namangan", "Norin", "Pop", "To'raqo'rg'on", "Uchqo'rg'on", "Uychi",
        "Yangiqo'rg'on") + _s("Namangan")),
    "UZ-NW": ("Navoiy viloyati", _t(
        "Karmana", "Konimex", "Navbahor", "Nurota", "Qiziltepa", "Tomdi", "Uchquduq", "Xatirchi")
        + _s("G'ozg'on", "Navoiy", "Zarafshon")),
    "UZ-QA": ("Qashqadaryo viloyati", _t(
        "Chiroqchi", "Dehqonobod", "G'uzor", "Kasbi", "Kitob", "Ko'kdala", "Koson", "Mirishkor", "Muborak", "Nishon",
        "Qamashi", "Qarshi", "Shahrisabz", "Yakkabog'") + _s("Qarshi", "Shahrisabz")),
    "UZ-QR": ("Qoraqalpog'iston Respublikasi", _t(
        "Amudaryo", "Beruniy", "Bo'zatov", "Chimboy", "Ellikqal'a", "Kegeyli", "Mo'ynoq", "Nukus", "Qanliko'l",
        "Qo'ng'irot", "Qorao'zak", "Shumanay", "Taxiatosh", "Taxtako'pir", "To'rtko'l", "Xo'jayli") + _s("Nukus")),
    "UZ-SA": ("Samarqand viloyati", _t(
        "Bulung'ur", "Ishtixon", "Jomboy", "Kattaqo'rg'on", "Narpay", "Nurobod", "Oqdaryo", "Pastdarg'om", "Paxtachi",
        "Payariq", "Qo'shrabot", "Samarqand", "Toyloq", "Urgut") + _s("Kattaqo'rg'on", "Samarqand")),
    "UZ-SI": ("Sirdaryo viloyati", _t(
        "Boyovut", "Guliston", "Mirzaobod", "Oqoltin", "Sardoba", "Sayxunobod", "Sirdaryo", "Xovos")
        + _s("Guliston", "Shirin", "Yangiyer")),
    "UZ-SU": ("Surxondaryo viloyati", _t(
        "Angor", "Bandixon", "Boysun", "Denov", "Jarqo'rg'on", "Muzrabot", "Oltinsoy", "Qiziriq", "Qumqo'rg'on",
        "Sariosiyo", "Sherobod", "Sho'rchi", "Termiz", "Uzun") + _s("Termiz")),
    "UZ-XO": ("Xorazm viloyati", _t(
        "Bog'ot", "Gurlan", "Hazorasp", "Qo'shko'pir", "Shovot", "Tuproqqal'a", "Urganch", "Xiva", "Xonqa", "Yangiariq",
        "Yangibozor") + _s("Urganch", "Xiva")),
}

REGION_NAMES = {name for name, _ in REGIONS.values()}

_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "ғ": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z", "и": "i",
    "й": "y", "к": "k", "қ": "q", "л": "l", "м": "m", "н": "n", "о": "o", "ў": "o", "п": "p", "р": "r", "с": "s",
    "т": "t", "у": "u", "ф": "f", "х": "x", "ҳ": "h", "ц": "s", "ч": "ch", "ш": "sh", "щ": "sh", "ы": "i", "э": "e",
    "ю": "yu", "я": "ya",
}
_NOISE = re.compile(r"\b(tumani|tuman|shahri|shahar|hokimiyati|viloyati|viloyat|respublikasi|rayon|rayoni|gorod"
                    r"|oblast|district|city|region|province|republic)\b")


def normalize(value: str) -> str:
    """Lotin va kirill, apostroflar, ruscha-inglizcha yozilish farqlarisiz solishtirish uchun.
    OSM da bir joy Chilanzar, Chilonzor yoki Чиланзар bo'lib kelishi mumkin."""
    text = "".join(_CYRILLIC.get(c, c) for c in value.lower())
    text = re.sub(r"[ʻʼ'’‘`´ьъ]", "", text)
    text = _NOISE.sub(" ", text).replace("kh", "x").replace("q", "k").replace("o", "a")
    return re.sub(r"[\s-]+", "", text)


def _is_city_name(value: str) -> bool:
    return bool(re.search(r"shahri|shahar|\bcity\b|город", value.lower()))


def match_region(values: list[str]) -> str | None:
    """Nomlar ichidan viloyat kodi. "Toshkent" yonida viloyat so'zi bo'lmasa, Toshkent shahri deb olinadi."""
    keys = {normalize(n): code for code, (n, _) in REGIONS.items() if code not in ("UZ-TK", "UZ-TO")}
    for value in values:
        lower = value.lower()
        if any(w in lower for w in ("tashkent", "toshkent", "ташкент", "тошкент")):
            return "UZ-TO" if re.search(r"viloyat|region|province|област|вилоят", lower) else "UZ-TK"
        if normalize(value) in keys:
            return keys[normalize(value)]
    return None


def region_by_district(values: list[str]) -> str | None:
    """OSM viloyatni bermagan joylar uchun: nom faqat bitta viloyatdagi tumanga mos kelsa, o'sha viloyat."""
    for value in values:
        key = normalize(value)
        codes = {code for code, (_, items) in REGIONS.items() if key and any(normalize(d) == key for d in items)}
        if len(codes) == 1:
            return codes.pop()
    return None


def match_district(region_code: str, names: list[tuple[str, bool]]) -> str | None:
    """names: (OSM nomi, shaharmi). Bir xil nomli tuman va shahar bo'lsa (Bekobod), turiga qarab tanlanadi."""
    districts = REGIONS[region_code][1]
    for value, is_city in names:
        key = normalize(value)
        if not key:
            continue
        found = [d for d in districts if normalize(d) == key]
        if found:
            suffix = "shahri" if is_city or _is_city_name(value) else "tumani"
            return next((d for d in found if d.endswith(suffix)), found[0])
    return None
