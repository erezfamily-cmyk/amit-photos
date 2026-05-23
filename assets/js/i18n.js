// ===== i18n — bilingual support (HE / EN) =====

const CATEGORY_MAP = {
  // Original simple categories
  'טבע': 'Nature', 'פורטרט': 'Portrait', 'עירוני': 'Urban',
  'אירועים': 'Events', 'מאקרו': 'Macro', 'נופים': 'Landscapes',
  'ספורט': 'Sport', 'אדריכלות': 'Architecture', 'חיות': 'Wildlife',
  'ים': 'Sea', 'מדבר': 'Desert', 'עצים': 'Trees',
  // D1 actual categories
  'מאקרו-צילומי תקריב': 'Macro & Close-ups',
  'טבע דומם': 'Still Life',
  'ישראל': 'Israel',
  'פורטרטים': 'Portraits',
  'פרחים וצמחים': 'Flowers & Plants',
  'צילום מופשט': 'Abstract Photography',
  'מקומות בעולם': 'Places Around the World',
  'ארצות': 'Locations',
  // Sub-categories (countries/cities)
  'אבו דאבי': 'Abu Dhabi',
  'אנגליה': 'England',
  'גרמניה': 'Germany',
  'הולנד': 'Netherlands',
  'יוון': 'Greece',
  'מונטנגרו': 'Montenegro',
  'סלובקיה': 'Slovakia',
  'סן דיאגו - ארה"ב': 'San Diego, USA',
  'צכיה': 'Czech Republic',
};

const TRANSLATIONS = {
  he: {
    // Nav
    'nav.logo.name':    'עמית ארז',
    'nav.logo.tagline': ' | עולם של צבעים מבעד לעדשה',
    'nav.gallery':      'גלריה',
    'nav.new':          'חדש באתר',
    'nav.sale':         'מבצע',
    'nav.challenges':   'אתגרים',
    'nav.camera':       'למד לצלם',
    'nav.locations':    'מקומות לצילום',
    'nav.learn':        'ניתוח תמונות',
    'nav.how-to-buy':   'כיצד לרכוש',
    'nav.pricing':      'מחירים',
    'nav.contact':      'צור קשר',
    'nav.menu':         'תפריט',

    // Hero
    'hero.title.main':  'תמונות שמדברות',
    'hero.title.em':    'אליך',
    'hero.subtitle':    'תמונות אמנותיות דיגיטליות לרכישה — הורדה מיידית לאחר תשלום',
    'hero.scroll':      'גלול',
    'hero.cta':         'עיין בגלריה',
    'hero.cta-ghost':   'כיצד לרכוש?',

    // Gallery section
    'gallery.label':    'לחץ על כל תמונה לרכישה',
    'gallery.title':    'הגלריה',
    'gallery.search.placeholder': 'חיפוש לפי שם תמונה...',
    'gallery.search.aria':        'חיפוש תמונות',
    'gallery.filter.all':         'הכל',
    'gallery.filter.new':         'חדש',
    'gallery.filter.sale':        'מבצע',
    'gallery.filter.wishlist':    'מועדפים',
    'gallery.filter.best':        'מובחרות',
    'featured.cta':               'כל המובחרות שלי →',
    'gallery.badge.new':          'חדש',
    'gallery.badge.sale':         '🏷 מבצע',
    'gallery.badge.week':         '⭐ תמונת השבוע',
    'gallery.price.from':         'החל מ-',
    'gallery.empty':    'אין תמונות בקטגוריה זו.',
    'gallery.btn.print':'הדפסה ←',
    'gallery.btn.buy':  'רכישה ←',
    'gallery.btn.cart': '+ סל',
    'week.label':    '⭐ תמונת השבוע',
    'week.discount': '25% הנחה השבוע על כל גדלי הרכישה',
    'week.buy':      'רכוש עכשיו',
    'week.preview':  '🖼 תצוגה על הקיר',
    'week.expand':   'הצג תמונה ▼',
    'week.collapse': 'סגור ▲',

    // About
    'about.label':           'אמנות הצילום',
    'about.title1':          'עמית ארז',
    'about.title2':          'שפה ויזואלית',
    'about.intro':           'הפלטפורמה המקצועית amitphotos.com הוקמה מתוך חזון המשלב מצוינות טכנית חסרת פשרות עם תשוקה עמוקה לתיעוד הטבע והנוף. כמי שרואה בצילום מדיום המגשר בין הטכנולוגיה לאומנות, אני פועל מתוך שאיפה לזקק את המציאות לכדי פריים המדבר בשפה ויזואלית מובחנת ומנומקת.',
    'about.section1.title':  'צילום כחוויה וכשפה אישית',
    'about.section1.text':   'עבורי, הצילום אינו מתמצה בתיעוד אובייקטיבי, אלא מהווה כלי לביטוי אישי ודרך להתבוננות מעמיקה בעולם. כל יצירה המוצגת כאן היא תולדה של דיאלוג מתמשך עם האור, המרחב והזמן. אני מאמין כי פיתוח "שפה אישית" הוא המפתח למעבר מצילום טכני ליצירה בעלת משמעות.',
    'about.section2.title':  'מרכז לידע והשראה',
    'about.learn.title':     'ללמוד איך לצלם',
    'about.learn.text':      'מדריכים מפורטים ונגישים — מהצד הטכני ועד לטכניקות שטח מתקדמות.',
    'about.understand.title':'להבין צילום',
    'about.understand.text': 'כלים לפענוח שפת האור, הקומפוזיציה והמנגנונים הויזואליים שגורמים לתמונה "לעבוד".',
    'about.inspire.title':   'לקבל רעיונות',
    'about.inspire.text':    'השראה לפרויקטים חדשים, זוויות ראייה מקוריות ודרכים יצירתיות לאתגרי צילום בשטח.',
    'about.section3.title':  'מקצוענות ללא פשרות',
    'about.section3.text':   'כצלם המשתמש במערכות הצילום המתקדמות ביותר של Nikon, אני מחויב לאיכות הקצה הגבוהה ביותר. השילוב בין הדיוק הטכני לבין חדוות הגילוי והכיף שביצירה — הוא הקו המנחה אותי.',
    'about.closing':         'אני מזמין אתכם לעיין בגלריות, להסתייע במדריכים המקצועיים, ולצאת יחד למסע של הבנה, למידה ויצירה.',
    'about.p3.link':         'מוזמן ליצור קשר',
    'about.stat1':           'תמונות בגלריה',
    'about.stat2':           'שנות ניסיון',
    'about.stat3':           'מסלולי ידע',
    'about.img.alt':         'עמית ארז — צלם',

    // How to buy
    'htb.label':        'פשוט ומהיר',
    'htb.title':        'כיצד לרכוש?',
    'htb.s1.title':     'עיין בגלריה',
    'htb.s1.desc':      'גלול בין מאות תמונות מקוריות ומצא את זו שמדברת אליך.',
    'htb.s2.title':     'בחר תמונה שאהבת',
    'htb.s2.desc':      'העבר עכבר מעל תמונה ולחץ "רכישה" (במובייל — הקש על התמונה) ובחר רזולוציה.',
    'htb.s3.title':     'שלם ב-PayPal',
    'htb.s3.desc':      'תשלום מאובטח ומהיר דרך PayPal — כרטיס אשראי או חשבון PayPal.',
    'htb.s4.title':     'הורד מיד',
    'htb.s4.desc':      'הקובץ מורד אוטומטית לאחר אישור התשלום. ללא המתנה.',

    // Gear
    'gear.label':       'הכלים שלי',
    'gear.title':       'הציוד שלי',
    'gear.camera.title':'גוף המצלמה',
    'gear.camera.l1':   'Full Frame מקצועי',
    'gear.camera.l2':   'חיישן רזולוציה גבוהה',
    'gear.camera.l3':   'ביצועי ISO מעולים בתאורה נמוכה',
    'gear.lenses.title':'עדשות',
    'gear.lenses.l1':   '85mm — פורטרטים',
    'gear.lenses.l2':   '16–35mm — נופים רחבים',
    'gear.lenses.l3':   '24–70mm — ורסטילית לכל סיטואציה',
    'gear.acc.title':   'אביזרים',
    'gear.acc.l1':      'Speedlight — תאורת פלאש חיצונית',
    'gear.acc.l2':      'חצובת קרבון — יציבות מקסימלית',
    'gear.acc.l3':      'פילטרים ND לחשיפות ארוכות',
    'gear.cta':         'לעמוד הציוד המלא ←',

    // Testimonials
    'test.label':       'מה אומרים עליי',
    'test.title':       'לקוחות ממליצים',
    'test.1.text':      '"עמית תפס רגעים שאפילו לא הבחנו בהם. כל תמונה היא סיפור שלם בפני עצמו — פשוט מרהיב."',
    'test.1.name':      'שירה כ.',
    'test.1.event':     'חתונה',
    'test.2.text':      '"מקצועי, קשוב ומדויק. התוצאות עלו על כל הציפיות שלנו. ממליץ בחום לכל אחד!"',
    'test.2.name':      'דני מ.',
    'test.2.event':     'פורטרט מסחרי',
    'test.3.text':      '"הבן שלנו יזכור את היום הזה לנצח, הודות לתמונות הנפלאות. תודה עמית!"',
    'test.3.name':      'נועה ל.',
    'test.3.event':     'בר מצווה',

    // Explore section (promo for camera/learn/locations)
    'explore.label':              'מה עוד תמצא כאן',
    'explore.title':              'ללמוד, לגלות, ליצור',
    'explore.camera.title':       'למד לצלם',
    'explore.camera.desc':        'מדריכים מעמיקים — חשיפה, עדשות, קומפוזיציה ועוד. לצלמים מתחילים ומתקדמים.',
    'explore.camera.cta':         'למדריכים ←',
    'explore.learn.title':        'ניתוח תמונות',
    'explore.learn.desc':         'כל תמונה בגלריה עם ניתוח מעמיק — מה מייחד אותה, איך צולמה, ומה אפשר ללמוד ממנה.',
    'explore.learn.cta':          'לניתוחים ←',
    'explore.locations.title':    'מקומות לצילום',
    'explore.locations.desc':     'מדריכי מקומות מומלצים בישראל ובעולם — עם טיפים לצילום וזמנים מומלצים.',
    'explore.locations.cta':      'לגלות מקומות ←',

    // Pricing
    'pricing.label':    'גדלים ומחירים',
    'pricing.title':    'בחר את הגודל שלך',
    'pricing.popular':  'פופולרי',
    'pricing.per-photo':'לתמונה',
    'pricing.cta':      'עיין בגלריה',
    'pricing.net.name': 'קובץ רשת',
    'pricing.net.f1':   'רזולוציה 1500px',
    'pricing.net.f2':   'מושלם לרשתות חברתיות',
    'pricing.net.f3':   'WhatsApp ופרופיל',
    'pricing.net.f4':   'שימוש אישי',
    'pricing.print.name':'קובץ הדפסה',
    'pricing.print.f1': 'רזולוציה 3000px',
    'pricing.print.f2': 'הדפסה איכותית עד A4',
    'pricing.print.f3': 'קישוט הבית',
    'pricing.print.f4': 'שימוש אישי מלא',
    'pricing.full.name':'קובץ מלא',
    'pricing.full.f1':  'רזולוציה מקסימלית',
    'pricing.full.f2':  'הדפסה גדולה (A1 ומעלה)',
    'pricing.full.f3':  'שימוש מסחרי',
    'pricing.full.f4':  'כל הזכויות כלולות',

    // FAQ
    'faq.label':        'הדפסות בדואר',
    'faq.title':        'שאלות נפוצות',
    'faq.q1':           'איך עובדת הזמנת הדפסה?',
    'faq.a1':           'בוחרים תמונה מהגלריה ולוחצים על "הדפסה ←". בוחרים סוג וגודל, ממלאים כתובת משלוח ומשלמים דרך PayPal. ההזמנה עוברת ישירות לבית הדפוס ומגיעה לביתכם בדואר — ללא כל מעורבות ידנית מצידי.',
    'faq.q2':           'כמה זמן לוקח המשלוח לישראל?',
    'faq.a2':           'בדרך כלל 7–10 ימי עסקים מרגע האישור. ההדפסה מיוצרת באירופה ונשלחת ישירות לכתובת שהזנת.',
    'faq.q3':           'מה כלול במחיר?',
    'faq.a3':           'המחיר המוצג כולל הדפסה + אריזה + משלוח בינלאומי עד הבית. הזמנות מעל $75 עשויות לחייב מע"מ 17% בקבלה (מכס ישראל) — זה מחוץ לשליטתנו.',
    'faq.q4':           'אילו סוגי הדפסה זמינים?',
    'faq.a4':           '<strong>פוסטר — נייר אמנות מט</strong> — נייר 170gsm, פינישינג מט, מוכן למסגור. צבעים עמוקים, ללא בוהק.<br><strong>קנבס</strong> — מתוח על מסגרת עץ, מוכן לתלייה ישירה על הקיר.<br><strong>הדפסה על מתכת</strong> — אלומיניום 3mm עם גימור מבריק יוקרתי, מוכן לתלייה. אפקט עומק ייחודי.',
    'faq.q5':           'האם ניתן להזמין גדלים מיוחדים?',
    'faq.a5':           'הגדלים המוצגים הם הזמינים באופן מיידי. לגדלים מותאמים אישית — <a href="#contact">צרו קשר</a> ואסדר זאת עבורכם.',
    'faq.q6':           'מה אם המוצר הגיע פגום?',
    'faq.a6':           'אם ההדפסה הגיעה פגומה — <a href="#contact">צרו קשר</a> עם תמונה של הנזק ואדאג להחלפה ללא עלות. בית הדפוס עומד מאחורי איכות המוצר.',
    'faq.q7':           'האם ניתן לבטל הזמנה?',
    'faq.a7':           'כן — תוך שעה מרגע ההזמנה. לאחר ההזמנה תקבלו מייל אישור עם כפתור "ביטול הזמנה". לחיצה על הכפתור תבטל אוטומטית — ללא צורך ליצור קשר. לאחר שעה ההזמנה עוברת לייצור ולא ניתן לבטל.',
    'faq.q8':           'האם התשלום מאובטח?',
    'faq.a8':           'התשלום מתבצע דרך PayPal — אחת מפלטפורמות התשלום המאובטחות בעולם. פרטי הכרטיס שלך לא מגיעים אלינו בשום שלב.',
    'faq.q9':           'יש בעיה עם ההזמנה — למי פונים?',
    'faq.a9':           'פנו ישירות אלי — עמית — בכל בעיה הקשורה להזמנת הדפסה:<br>📧 <a href="mailto:contact@amitphotos.com">contact@amitphotos.com</a><br>📞 <a href="tel:050-3333227">050-3333227</a><br><br>אני מטפל מול בית הדפוס עד לפתרון מלא — החלפה או החזר כספי.',

    // Contact
    'contact.label':    'בואו נדבר',
    'contact.title':    'צור קשר',
    'contact.h3':       'נשמח לשמוע ממך',
    'contact.p':        'שאלה על תמונה? רוצה רישיון מסחרי? גודל מותאם אישית? השאר פרטים ואחזור אליך בהקדם.',
    'contact.address':  'ישעיהו הנביא 37, מודיעין',
    'contact.f.name':   'שם מלא',
    'contact.f.email':  'אימייל',
    'contact.f.topic':  'נושא',
    'contact.f.topic.select': 'בחר נושא...',
    'contact.f.t1':     'רכישת תמונה',
    'contact.f.t2':     'רישיון מסחרי',
    'contact.f.t3':     'גודל מותאם אישית',
    'contact.f.t4':     'שאלה כללית',
    'contact.f.t5':     'אחר',
    'contact.f.message':'הודעה',
    'contact.f.message.placeholder': 'על איזו תמונה מדובר? מה השימוש המיועד?',
    'contact.f.submit': 'שלח הודעה ←',
    'contact.success':  'ההודעה נשלחה!',
    'contact.success.p':'אחזור אליך בהקדם.',

    // Newsletter
    'newsletter.title': 'הישארו מעודכנים',
    'newsletter.p':     'תמונות חדשות, מבצעים בלעדיים ותוכן מאחורי הקלעים — ישירות למייל.',
    'newsletter.placeholder': 'כתובת המייל שלך',
    'newsletter.btn':   'הרשמה',
    'newsletter.ok':    'תודה! נרשמת בהצלחה.',
    'newsletter.err':   'שגיאה בהרשמה. נסה שוב.',
    'newsletter.err.net':'שגיאת חיבור. נסה שוב.',

    // Footer
    'footer.copy':      '© 2026 עמית — כל הזכויות שמורות',

    // Lightbox
    'lb.related':       'עוד מהקטגוריה',
    'lb.slideshow.start':'▶ מצגת',
    'lb.slideshow.stop': '⏸ עצור',
    'lb.wall':          '🖼 על הקיר',
    'lb.print':         'הדפסה ←',
    'lb.buy':           'רכישה ←',
    'lb.whatsapp':      'וואטסאפ',
    'lb.facebook':      'פייסבוק',
    'lb.pinterest':     'Pinterest',
    'lb.copy-link':     'העתק קישור',
    'lb.copied':        '✓ הועתק!',
    'lb.back':          '← חזרה לגלריה',
    'lb.kbd':           '← → לניווט\u00a0|\u00a0ESC לסגירה',
    'lb.password.prompt':'הזן סיסמה להורדת התמונה:',
    'lb.password.wrong':'סיסמה שגויה. נסה שוב.',
    'lb.error':         'שגיאה. נסה שוב.',
    'wall.disclaimer':  '* התמונה להמחשה בלבד — הגודל והצבעים האמיתיים עשויים להשתנות',
    'wall.modal.aria':  'תצוגת קיר',
    'close':            'סגור',
    'buy.modal.aria':   'רכישת תמונה',
    'print.modal.aria': 'הזמנת הדפסה',

    // Cart modal
    'cart.open.aria':   'פתח סל קניות',
    'cart.modal.aria':  'סל קניות',
    'cart.label':       'סל קניות',
    'cart.title':       'התמונות שבחרת',
    'cart.empty':       'הסל ריק',
    'cart.remove.aria': 'הסר',
    'cart.size.label':  'בחר גודל לכל התמונות:',
    'cart.total':       'סה"כ',
    'cart.discount':    'הנחת חבילה (20%)',
    'cart.to-pay':      'לתשלום',
    'cart.checkout':    'תשלום דרך PayPal →',
    'cart.note':        'מ-5 תמונות ומעלה — הנחה של 20% אוטומטית',

    // Buy modal
    'buy.label':        'רכישת תמונה',
    'buy.subtitle':     'בחר רזולוציה',
    'buy.guide.small':  'סטורי / WhatsApp',
    'buy.guide.medium': 'הדפסה עד A4',
    'buy.guide.large':  'פוסטר / A1 ומעלה',
    'buy.email.placeholder': 'מייל לקבלת הקישור גם במייל (אופציונלי)',
    'buy.size.small':   'קובץ רשת',
    'buy.size.small.use':'רשתות חברתיות',
    'buy.size.medium':  'קובץ הדפסה',
    'buy.size.medium.use':'הדפסה עד A4',
    'buy.size.large':   'קובץ מלא',
    'buy.size.large.px':'רזולוציה מקסימלית',
    'buy.size.large.use':'הדפסה גדולה',
    'buy.recommended':  'מומלץ',
    'buy.size.requires': 'נדרש {{min}}px+ (קובץ זה: {{actual}}px)',
    'buy.step.size.done': 'רזולוציה',
    'buy.step.confirm':   'אישור',
    'buy.confirm.buying': 'אתה קונה',
    'buy.total':          'סה״כ לתשלום',
    'buy.paypal.btn':     'שלם עם PayPal',
    'buy.secure.note':    '🔒 תועבר לדף התשלום המאובטח של PayPal',
    'buy.auto.download':  'הקובץ יורד אוטומטית לאחר האישור',
    'buy.back':           '← חזרה',
    'buy.note':         'לאחר התשלום הקובץ יורד אוטומטית. תשלום מאובטח דרך PayPal.',
    'buy.alt.prefix':   'ניתן לרכוש גם ב',
    'buy.alt.suffix':   ' בפנייה טלפונית:',

    // Print modal
    'print.label':      'הזמנת הדפסה',
    'print.prog.type':  'סוג',
    'print.prog.size':  'גודל',
    'print.prog.ship':  'משלוח',
    'print.s1.subtitle':'בחר סוג הדפסה',
    'print.back':       '← חזור',
    'print.crop.label': 'גרור לבחירת חיתוך',
    'print.crop.hint':  'התמונה תודפס בדיוק כפי שמוצג',
    'print.wrap.title': 'גימור צדדים',
    'print.customs':    '⚠️ הזמנות מעל $75 עשויות לחייב מע"מ 17% בקבלה (מכס)',
    'print.continue':   'המשך לפרטי משלוח →',
    'print.s3.subtitle':'פרטי משלוח',
    'print.name.ph':    'שם מלא *',
    'print.phone.ph':   'טלפון *',
    'print.email.ph':   'מייל (לאישור הזמנה)',
    'print.addr.ph':    'כתובת (רחוב ומספר) *',
    'print.city.ph':    'עיר *',
    'print.zip.ph':     'מיקוד *',
    'print.pay.prefix': 'שלם דרך PayPal — ',
    'print.ship.note':  'המוצר יישלח ישירות לביתך בדואר. זמן משלוח: 7–10 ימי עסקים.',

    // JS dynamic strings
    'form.sending':     'שולח...',
    'form.submit':      'שלח הודעה ←',
    'form.error':       'שגיאה בשליחה, נסה שוב.',
    'form.v.name':      'נא להזין שם',
    'form.v.email':     'נא להזין כתובת אימייל תקינה',
    'form.v.message':   'נא להזין הודעה',
    'print.v.fields':   'נא למלא את כל השדות המסומנים ב-*',
    'print.processing': 'מעבד חיתוך...',
    'print.loading':    'טוען מחיר...',
    'print.err.net':    'שגיאת רשת',
    'print.res.low':    '❌ רזולוציה נמוכה מדי לגודל זה — בחר גודל קטן יותר',
    'print.res.warn':   '⚠️ רזולוציה נמוכה מהמומלץ — ההדפסה עשויה להיות פחות חדה',
    'print.res.ok':     '✓ רזולוציה מתאימה ל-300 DPI',
    'print.res.req':    'נדרש {{dim}}px+',
    'print.price':      '${{price}} — כולל משלוח לישראל',
    'print.price.err':  'שגיאה בטעינת מחיר',

    // print types (catalog override)
    'print.type.poster.label':   'פוסטר — נייר אמנות מט',
    'print.type.poster.desc':    'נייר אמנות 170gsm, פינישינג מט — כולל משלוח לישראל',
    'print.type.canvas.label':   'הדפסה על קנבס',
    'print.type.canvas.desc':    'קנבס מתוח על מסגרת עץ, מוכן לתלייה — כולל משלוח לישראל',
    'print.type.metallic.label': 'הדפסה על מתכת',
    'print.type.metallic.desc':  'הדפסה על אלומיניום 3mm — גימור מבריק יוקרתי, מוכן לתלייה — כולל משלוח לישראל',

    // download.html
    'dl.verifying.title':'מאמת תשלום...',
    'dl.verifying.sub': 'אנא המתן, בודק את פרטי התשלום עם PayPal.',
    'dl.expire.note':   'שמור את הקובץ לאחר ההורדה — לשאלות פנה ב-WhatsApp.',
    'dl.back':          '← חזרה לגלריה',
    'dl.success.title': 'תודה על הרכישה!',
    'dl.success.sub':   'התשלום אושר. לחץ להורדת "{{title}}".',
    'dl.success.multi': 'התשלום אושר. {{count}} תמונות מוכנות להורדה.',
    'dl.download':      'הורד: {{title}} ↓',
    'dl.already.title': 'הקישור כבר נוצר',
    'dl.already.sub':   'עסקה זו כבר עובדה ונשלחו קישורי הורדה. אם לא קיבלת את הקבצים, <a href="mailto:erez.family@gmail.com" style="color:#c8a96e">שלח מייל</a> עם מספר העסקה.',
    'dl.manual.title':  'תשלום התקבל',
    'dl.manual.sub':    'הקובץ יישלח אליך במייל בקרוב. אם לא קיבלת תוך שעה — צור קשר.',
    'dl.error.title':   'לא ניתן לאמת תשלום',
    'dl.error.sub':     'אם שילמת ולא קיבלת את הקובץ, <a href="mailto:erez.family@gmail.com" style="color:#c8a96e">שלח מייל</a> עם אישור התשלום.',

    // print-complete.html
    'pc.loading':       'מאמת תשלום ויוצר הזמנה...',
    'pc.ok.title':      'ההזמנה התקבלה!',
    'pc.ok.p1':         'ההדפסה נשלחה לייצור ותגיע לביתך תוך 7–14 ימי עסקים.',
    'pc.ok.p2':         'אם הזנת מייל — תקבל עדכון כשהמוצר יישלח.',
    'pc.ok.back':       'חזרה לגלריה',
    'pc.ok.order':      'מספר הזמנה: {{id}}',
    'pc.err.title':     'משהו השתבש',
    'pc.err.params':    'פרמטרים חסרים — אנא צור קשר.',
    'pc.err.net':       'שגיאת רשת — אנא נסה שוב או צור קשר.',
    'pc.err.unknown':   'שגיאה לא ידועה',
    'pc.err.back':      'חזרה לאתר',

    // 404
    '404.title':        'הדף לא נמצא',
    '404.p':            'נראה שהתמונה הזו זזה... חזור לגלריה הראשית.',
    '404.btn':          'חזרה לבית',
  },

  en: {
    // Nav
    'nav.logo.name':    'Amit Erez',
    'nav.logo.tagline': ' | A World of Colors Through the Lens',
    'nav.gallery':      'Gallery',
    'nav.new':          'New',
    'nav.sale':         'Sale',
    'nav.challenges':   'Challenges',
    'nav.camera':       'Learn Photography',
    'nav.locations':    'Locations',
    'nav.learn':        'Photo School',
    'nav.how-to-buy':   'How to Buy',
    'nav.pricing':      'Pricing',
    'nav.contact':      'Contact',
    'nav.menu':         'Menu',

    // Hero
    'hero.title.main':  'Photos That Speak',
    'hero.title.em':    'To You',
    'hero.subtitle':    'Fine art digital photos for purchase — instant download after payment',
    'hero.scroll':      'Scroll',
    'hero.cta':         'Browse Gallery',
    'hero.cta-ghost':   'How to Buy?',

    // Gallery section
    'gallery.label':    'Click any photo to purchase',
    'gallery.title':    'Gallery',
    'gallery.search.placeholder': 'Search by photo name...',
    'gallery.search.aria':        'Search photos',
    'gallery.filter.all':         'All',
    'gallery.filter.new':         'New',
    'gallery.filter.sale':        'Sale',
    'gallery.filter.wishlist':    'Wishlist',
    'gallery.filter.best':        'Best Of',
    'featured.cta':               'All My Best →',
    'gallery.badge.new':          'New',
    'gallery.badge.sale':         '🏷 Sale',
    'gallery.badge.week':         '⭐ Photo of the Week',
    'gallery.price.from':         'From ',
    'gallery.empty':    'No photos in this category.',
    'gallery.btn.print':'Print →',
    'gallery.btn.buy':  'Purchase →',
    'gallery.btn.cart': '+ Cart',
    'week.label':    '⭐ Photo of the Week',
    'week.discount': '25% off this week — all sizes',
    'week.buy':      'Buy Now',
    'week.preview':  '🖼 Preview on Wall',
    'week.expand':   'Show Photo ▼',
    'week.collapse': 'Close ▲',

    // About
    'about.label':           'The Art of Photography',
    'about.title1':          'Amit Erez',
    'about.title2':          'Visual Language',
    'about.intro':           'amitphotos.com was founded with a vision that combines uncompromising technical excellence with a deep passion for documenting nature and landscape. Seeing photography as a medium that bridges technology and art, I strive to distill reality into frames that speak a distinctive and reasoned visual language.',
    'about.section1.title':  'Photography as Experience and Personal Language',
    'about.section1.text':   'For me, photography is not merely objective documentation — it is a tool for personal expression and a means of deep observation of the world. Every work presented here is the result of an ongoing dialogue with light, space, and time. I believe that developing a personal visual language is the key to transitioning from technical photography to meaningful creation.',
    'about.section2.title':  'A Hub for Knowledge & Inspiration',
    'about.learn.title':     'Learn how to shoot',
    'about.learn.text':      'Detailed, accessible guides — from mastering equipment to advanced field techniques.',
    'about.understand.title':'Understand photography',
    'about.understand.text': 'Tools for decoding the language of light, composition, and the visual mechanisms that make a photograph work.',
    'about.inspire.title':   'Get inspired',
    'about.inspire.text':    'Fresh ideas for new projects, original angles of vision, and creative approaches to real-world photography challenges.',
    'about.section3.title':  'Uncompromising Professionalism',
    'about.section3.text':   'As a photographer using Nikon\'s most advanced camera systems, I am committed to the highest level of quality. The combination of technical precision with the joy of discovery and creation is my guiding principle.',
    'about.closing':         'I invite you to browse the galleries, explore the professional guides, and embark together on a journey of understanding, learning, and creation.',
    'about.p3.link':         'Feel free to contact me',
    'about.stat1':           'photos in gallery',
    'about.stat2':           'years of experience',
    'about.stat3':           'knowledge tracks',
    'about.img.alt':         'Amit Erez — Photographer',

    // How to buy
    'htb.label':        'Simple & Fast',
    'htb.title':        'How to Buy?',
    'htb.s1.title':     'Browse the Gallery',
    'htb.s1.desc':      'Scroll through hundreds of original photos and find the one that speaks to you.',
    'htb.s2.title':     'Find a Photo You Love',
    'htb.s2.desc':      'Hover over a photo and click "Purchase" (on mobile — tap the photo), then choose your resolution.',
    'htb.s3.title':     'Pay with PayPal',
    'htb.s3.desc':      'Secure and fast payment via PayPal — credit card or PayPal account.',
    'htb.s4.title':     'Download Instantly',
    'htb.s4.desc':      'The file downloads automatically after payment confirmation. No waiting.',

    // Gear
    'gear.label':       'My Tools',
    'gear.title':       'My Gear',
    'gear.camera.title':'Camera Body',
    'gear.camera.l1':   'Professional Full Frame',
    'gear.camera.l2':   'High-resolution sensor',
    'gear.camera.l3':   'Excellent low-light ISO performance',
    'gear.lenses.title':'Lenses',
    'gear.lenses.l1':   '85mm — Portraits',
    'gear.lenses.l2':   '16–35mm — Wide landscapes',
    'gear.lenses.l3':   '24–70mm — Versatile all-purpose',
    'gear.acc.title':   'Accessories',
    'gear.acc.l1':      'Speedlight — external flash',
    'gear.acc.l2':      'Carbon tripod — maximum stability',
    'gear.acc.l3':      'ND filters for long exposures',
    'gear.cta':         'View Full Gear Page →',

    // Testimonials
    'test.label':       'What People Say',
    'test.title':       'Customer Reviews',
    'test.1.text':      '"Amit captured moments we didn\'t even notice. Every photo is a complete story — simply breathtaking."',
    'test.1.name':      'Shira K.',
    'test.1.event':     'Wedding',
    'test.2.text':      '"Professional, attentive, and precise. The results exceeded all our expectations. Highly recommended!"',
    'test.2.name':      'Danny M.',
    'test.2.event':     'Commercial Portrait',
    'test.3.text':      '"Our son will remember this day forever, thanks to the wonderful photos. Thank you Amit!"',
    'test.3.name':      'Noa L.',
    'test.3.event':     'Bar Mitzvah',

    // Explore section (promo for camera/learn/locations)
    'explore.label':              'Discover More',
    'explore.title':              'Learn, Explore, Create',
    'explore.camera.title':       'Learn Photography',
    'explore.camera.desc':        'In-depth guides on exposure, lenses, composition, and more — for beginners and advanced shooters alike.',
    'explore.camera.cta':         'View Guides →',
    'explore.learn.title':        'Photo Analysis',
    'explore.learn.desc':         'Each gallery photo comes with a deep-dive analysis — what makes it special, how it was shot, and what you can learn from it.',
    'explore.learn.cta':          'View Analyses →',
    'explore.locations.title':    'Photography Locations',
    'explore.locations.desc':     'Curated location guides across Israel and the world — with shooting tips and best-visit times.',
    'explore.locations.cta':      'Explore Locations →',

    // Pricing
    'pricing.label':    'Sizes & Prices',
    'pricing.title':    'Choose Your Size',
    'pricing.popular':  'Popular',
    'pricing.per-photo':'per photo',
    'pricing.cta':      'Browse Gallery',
    'pricing.net.name': 'Web File',
    'pricing.net.f1':   '1500px resolution',
    'pricing.net.f2':   'Perfect for social media',
    'pricing.net.f3':   'WhatsApp & profile',
    'pricing.net.f4':   'Personal use',
    'pricing.print.name':'Print File',
    'pricing.print.f1': '3000px resolution',
    'pricing.print.f2': 'Quality printing up to A4',
    'pricing.print.f3': 'Home decoration',
    'pricing.print.f4': 'Full personal use',
    'pricing.full.name':'Full File',
    'pricing.full.f1':  'Maximum resolution',
    'pricing.full.f2':  'Large printing (A1 and above)',
    'pricing.full.f3':  'Commercial use',
    'pricing.full.f4':  'All rights included',

    // FAQ
    'faq.label':        'Mail Prints',
    'faq.title':        'Frequently Asked Questions',
    'faq.q1':           'How does print ordering work?',
    'faq.a1':           'Choose a photo from the gallery and click "Print →". Select the type and size, fill in the shipping address and pay via PayPal. The order goes directly to the print house and arrives at your door by mail — no manual involvement on my part.',
    'faq.q2':           'How long does shipping to Israel take?',
    'faq.a2':           'Usually 7–10 business days from confirmation. The print is produced in Europe and shipped directly to the address you entered.',
    'faq.q3':           'What\'s included in the price?',
    'faq.a3':           'The displayed price includes printing + packaging + international shipping to your door. Orders over $75 may incur 17% VAT upon receipt (Israeli customs) — this is beyond our control.',
    'faq.q4':           'What types of printing are available?',
    'faq.a4':           '<strong>Poster — Matte Art Paper</strong> — 170gsm paper, matte finish, ready for framing. Deep colors, no glare.<br><strong>Canvas</strong> — stretched on a wooden frame, ready to hang directly on the wall.<br><strong>Metal Print</strong> — 3mm aluminum with premium glossy finish, ready to hang. Unique depth effect.',
    'faq.q5':           'Can I order custom sizes?',
    'faq.a5':           'The displayed sizes are immediately available. For custom sizes — <a href="#contact">contact me</a> and I\'ll arrange it for you.',
    'faq.q6':           'What if the product arrived damaged?',
    'faq.a6':           'If the print arrived damaged — <a href="#contact">contact me</a> with a photo of the damage and I\'ll arrange a free replacement. The print house stands behind product quality.',
    'faq.q7':           'Can I cancel an order?',
    'faq.a7':           'Yes — within one hour of placing the order. After ordering you\'ll receive a confirmation email with a "Cancel Order" button. Clicking it will cancel automatically — no need to contact me. After one hour the order goes into production and cannot be cancelled.',
    'faq.q8':           'Is the payment secure?',
    'faq.a8':           'Payment is processed through PayPal — one of the most secure payment platforms in the world. Your card details never reach us at any point.',
    'faq.q9':           'Having an issue with an order — who to contact?',
    'faq.a9':           'Contact me directly — Amit — for any issue related to a print order:<br>📧 <a href="mailto:contact@amitphotos.com">contact@amitphotos.com</a><br>📞 <a href="tel:050-3333227">050-3333227</a><br><br>I handle everything with the print house until fully resolved — replacement or refund.',

    // Contact
    'contact.label':    'Let\'s Talk',
    'contact.title':    'Contact',
    'contact.h3':       'We\'d Love to Hear from You',
    'contact.p':        'A question about a photo? Want a commercial license? Custom size? Leave your details and I\'ll get back to you shortly.',
    'contact.address':  'Isaiah the Prophet 37, Modi\'in',
    'contact.f.name':   'Full Name',
    'contact.f.email':  'Email',
    'contact.f.topic':  'Topic',
    'contact.f.topic.select': 'Select a topic...',
    'contact.f.t1':     'Purchase a photo',
    'contact.f.t2':     'Commercial license',
    'contact.f.t3':     'Custom size',
    'contact.f.t4':     'General question',
    'contact.f.t5':     'Other',
    'contact.f.message':'Message',
    'contact.f.message.placeholder': 'Which photo are you asking about? What is the intended use?',
    'contact.f.submit': 'Send Message →',
    'contact.success':  'Message Sent!',
    'contact.success.p':'I\'ll get back to you soon.',

    // Newsletter
    'newsletter.title': 'Stay Updated',
    'newsletter.p':     'New photos, exclusive offers and behind-the-scenes content — straight to your inbox.',
    'newsletter.placeholder': 'Your email address',
    'newsletter.btn':   'Subscribe',
    'newsletter.ok':    'Thank you! You\'ve subscribed.',
    'newsletter.err':   'Subscription error. Please try again.',
    'newsletter.err.net':'Connection error. Please try again.',

    // Footer
    'footer.copy':      '© 2026 Amit — All rights reserved',

    // Lightbox
    'lb.related':       'More from this category',
    'lb.slideshow.start':'▶ Slideshow',
    'lb.slideshow.stop': '⏸ Stop',
    'lb.wall':          '🖼 On the Wall',
    'lb.print':         'Print →',
    'lb.buy':           'Purchase →',
    'lb.whatsapp':      'WhatsApp',
    'lb.facebook':      'Facebook',
    'lb.pinterest':     'Pinterest',
    'lb.copy-link':     'Copy Link',
    'lb.copied':        '✓ Copied!',
    'lb.back':          'Back to Gallery →',
    'lb.kbd':           '← → navigate\u00a0|\u00a0ESC close',
    'lb.password.prompt':'Enter password to download:',
    'lb.password.wrong':'Wrong password. Try again.',
    'lb.error':         'Error. Try again.',
    'wall.disclaimer':  '* For illustration only — actual size and colors may vary',
    'wall.modal.aria':  'Wall Preview',
    'close':            'Close',
    'buy.modal.aria':   'Purchase Photo',
    'print.modal.aria': 'Print Order',

    // Cart modal
    'cart.open.aria':   'Open cart',
    'cart.modal.aria':  'Shopping Cart',
    'cart.label':       'Shopping Cart',
    'cart.title':       'Your Selected Photos',
    'cart.empty':       'Your cart is empty',
    'cart.remove.aria': 'Remove',
    'cart.size.label':  'Select size for all photos:',
    'cart.total':       'Total',
    'cart.discount':    'Bundle discount (20%)',
    'cart.to-pay':      'To Pay',
    'cart.checkout':    'Pay via PayPal →',
    'cart.note':        '5+ photos — 20% discount applied automatically',

    // Buy modal
    'buy.label':        'Purchase Photo',
    'buy.subtitle':     'Choose Resolution',
    'buy.guide.small':  'Story / WhatsApp',
    'buy.guide.medium': 'Print up to A4',
    'buy.guide.large':  'Poster / A1 and above',
    'buy.email.placeholder': 'Email to also receive the link (optional)',
    'buy.size.small':   'Web File',
    'buy.size.small.use':'Social Media',
    'buy.size.medium':  'Print File',
    'buy.size.medium.use':'Printing up to A4',
    'buy.size.large':   'Full File',
    'buy.size.large.px':'Maximum Resolution',
    'buy.size.large.use':'Large Printing',
    'buy.recommended':  'Recommended',
    'buy.size.requires': 'Requires {{min}}px+ (this file: {{actual}}px)',
    'buy.step.size.done': 'Resolution',
    'buy.step.confirm':   'Confirm',
    'buy.confirm.buying': "You're buying",
    'buy.total':          'Total',
    'buy.paypal.btn':     'Pay with PayPal',
    'buy.secure.note':    "🔒 You'll be redirected to PayPal's secure checkout",
    'buy.auto.download':  'File downloads automatically after payment',
    'buy.back':           '← Back',
    'buy.note':         'After payment the file downloads automatically. Secure payment via PayPal.',
    'buy.alt.prefix':   'Also available via Bit / Paybox — call us:',
    'buy.alt.suffix':   '',

    // Print modal
    'print.label':      'Print Order',
    'print.prog.type':  'Type',
    'print.prog.size':  'Size',
    'print.prog.ship':  'Shipping',
    'print.s1.subtitle':'Choose Print Type',
    'print.back':       'Back ←',
    'print.crop.label': 'Drag to select crop',
    'print.crop.hint':  'Photo will be printed exactly as shown',
    'print.wrap.title': 'Side Finish',
    'print.customs':    '⚠️ Orders over $75 may require 17% VAT upon receipt (customs)',
    'print.continue':   'Continue to Shipping →',
    'print.s3.subtitle':'Shipping Details',
    'print.name.ph':    'Full name *',
    'print.phone.ph':   'Phone *',
    'print.email.ph':   'Email (for order confirmation)',
    'print.addr.ph':    'Address (street and number) *',
    'print.city.ph':    'City *',
    'print.zip.ph':     'ZIP Code *',
    'print.pay.prefix': 'Pay via PayPal — ',
    'print.ship.note':  'Product will be shipped directly to your door. Delivery: 7–10 business days.',

    // JS dynamic strings
    'form.sending':     'Sending...',
    'form.submit':      'Send Message →',
    'form.error':       'Send error. Please try again.',
    'form.v.name':      'Please enter your name',
    'form.v.email':     'Please enter a valid email address',
    'form.v.message':   'Please enter a message',
    'print.v.fields':   'Please fill in all required fields (*)',
    'print.processing': 'Processing crop...',
    'print.loading':    'Loading price...',
    'print.err.net':    'Network error',
    'print.res.low':    '❌ Resolution too low for this size — choose a smaller size',
    'print.res.warn':   '⚠️ Resolution below recommended — print may be less sharp',
    'print.res.ok':     '✓ Resolution suitable for 300 DPI',
    'print.res.req':    'Required {{dim}}px+',
    'print.price':      '${{price}} — shipping included',
    'print.price.err':  'Error loading price',

    // print types (catalog override)
    'print.type.poster.label':   'Poster — Matte Art Paper',
    'print.type.poster.desc':    '170gsm art paper, matte finish — shipping to Israel included',
    'print.type.canvas.label':   'Canvas Print',
    'print.type.canvas.desc':    'Canvas stretched on a wooden frame, ready to hang — shipping included',
    'print.type.metallic.label': 'Metal Print',
    'print.type.metallic.desc':  '3mm aluminum print — glossy luxury finish, ready to hang — shipping included',

    // download.html
    'dl.verifying.title':'Verifying payment...',
    'dl.verifying.sub': 'Please wait, verifying payment details with PayPal.',
    'dl.expire.note':   'Save the file after downloading — for questions contact via WhatsApp.',
    'dl.back':          '← Back to Gallery',
    'dl.success.title': 'Thank you for your purchase!',
    'dl.success.sub':   'Payment confirmed. Click to download "{{title}}".',
    'dl.success.multi': 'Payment confirmed. {{count}} photos ready for download.',
    'dl.download':      'Download: {{title}} ↓',
    'dl.already.title': 'Link Already Generated',
    'dl.already.sub':   'This transaction has already been processed and download links were sent. If you didn\'t receive the files, <a href="mailto:erez.family@gmail.com" style="color:#c8a96e">send an email</a> with your transaction number.',
    'dl.manual.title':  'Payment Received',
    'dl.manual.sub':    'The file will be sent to your email shortly. If you don\'t receive it within an hour — contact us.',
    'dl.error.title':   'Unable to Verify Payment',
    'dl.error.sub':     'If you paid and didn\'t receive the file, <a href="mailto:erez.family@gmail.com" style="color:#c8a96e">send an email</a> with your payment confirmation.',

    // print-complete.html
    'pc.loading':       'Verifying payment and creating order...',
    'pc.ok.title':      'Order Received!',
    'pc.ok.p1':         'Your print has been sent to production and will arrive within 7–14 business days.',
    'pc.ok.p2':         'If you entered an email — you\'ll receive an update when the product ships.',
    'pc.ok.back':       'Back to Gallery',
    'pc.ok.order':      'Order #{{id}}',
    'pc.err.title':     'Something Went Wrong',
    'pc.err.params':    'Missing parameters — please contact us.',
    'pc.err.net':       'Network error — please try again or contact us.',
    'pc.err.unknown':   'Unknown error',
    'pc.err.back':      'Back to Site',

    // 404
    '404.title':        'Page Not Found',
    '404.p':            'It seems this photo moved... Return to the main gallery.',
    '404.btn':          'Back Home',
  },
};

// ===== Runtime =====

let _lang = localStorage.getItem('lang') || 'he';

function t(key, params) {
  let str = (TRANSLATIONS[_lang] && TRANSLATIONS[_lang][key]) ||
            (TRANSLATIONS['he'][key]) || key;
  if (params) {
    Object.keys(params).forEach(k => {
      str = str.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), params[k]);
    });
  }
  return str;
}

function getLang() { return _lang; }

function getCategoryLabel(cat) {
  if (_lang === 'en' && CATEGORY_MAP[cat]) return CATEGORY_MAP[cat];
  return cat;
}

function applyTranslations() {
  document.documentElement.lang = _lang;
  document.documentElement.dir  = _lang === 'he' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    // Allow HTML in FAQ answers
    if (el.dataset.i18nHtml !== undefined) {
      el.innerHTML = val;
    } else {
      el.textContent = val;
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });

  // Update lang toggle button states
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === _lang);
  });
}

function setLang(lang) {
  _lang = lang;
  localStorage.setItem('lang', lang);
  applyTranslations();
  const phoneEl = document.getElementById('buy-alt-phone');
  if (phoneEl) {
    phoneEl.textContent = lang === 'en' ? '+972 50-333-3227' : '050-3333227';
  }
  // Re-render dynamic gallery content if available
  if (typeof window.onLangChange === 'function') window.onLangChange();
  // Sync injected nav (nav.js) if present
  if (typeof window.applyNavLang === 'function' && !window.__navLangApplying) window.applyNavLang(lang);
}

// Apply on load
document.addEventListener('DOMContentLoaded', applyTranslations);
