"""Shared editorial direction for automated social posts."""

import hashlib


EDITORIAL_RULES_HE = """כללי עריכה:
- פתח בפרט חזותי קונקרטי מהצילום, לא במשפט כללי.
- בחר רעיון אחד בלבד: סיפור, החלטה צילומית או שאלה ממוקדת.
- אל תמציא מיקום, זמן המתנה, תנאי צילום או כוונת צלם שאינם מופיעים בתמונה או במטא-דאטה.
- הסבר מונח טכני דרך ההשפעה שלו על התמונה.
- השתמש בקריאה אחת לפעולה לכל היותר.
- הימנע מ״רגע קסום״, ״תמונה מדהימה״, ״מה אתם חושבים?״, ״נחשו״ ומלל שיווקי כללי.
- לפני ההחזרה, ערוך את הטקסט כך שכל משפט מוסיף מידע חדש."""


def editorial_angle(key):
    """Return a stable 40/40/20 editorial mix for repeatable measurement."""
    digest = hashlib.sha256(str(key).encode("utf-8")).digest()[0] % 5
    return ("story", "story", "technique", "technique", "conversation")[digest]


def publication_angle(key):
    """Reserve a stable quarter of photo posts for the free-guide campaign."""
    digest = hashlib.sha256(str(key).encode("utf-8")).digest()
    return "guide" if digest[1] % 4 == 0 else editorial_angle(key)


def angle_instruction_he(angle):
    return {
        "story": (
            "זווית התוכן: סיפור קצר. תאר פרט אחד שמשך את העין והחלטה אחת שנולדה ממנו. "
            "אל תסיים בשאלה."
        ),
        "technique": (
            "זווית התוכן: תובנה שימושית. הסבר החלטה צילומית אחת ומה היא שינתה בפריים. "
            "כתוב כך שצלם יוכל ליישם את הרעיון."
        ),
        "conversation": (
            "זווית התוכן: שיחה. פתח בתצפית קונקרטית וסיים בשאלה אחת ממוקדת שאפשר לענות "
            "עליה מתוך התמונה. בלי שאלת ניחוש כללית."
        ),
    }.get(angle, "זווית התוכן: סיפור קצר ומדויק על פרט אחד בצילום.")


def angle_instruction_en(angle):
    return {
        "story": "Tell one short story about a visible detail and one photographic choice. Do not end with a question.",
        "technique": "Explain one useful photographic choice and the visible effect it created.",
        "conversation": "Start with a concrete observation and end with one specific question that can be answered from the images.",
    }.get(angle, "Tell one concise story about a visible detail in the photographs.")
