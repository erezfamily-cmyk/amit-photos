# כפתור "רענן סטטוס" להזמנות Gelato

## מטרה
אפשרות לרענן ידנית את סטטוס הזמנת הדפסה מ-Gelato, למקרה שה-webhook לא הגיע.

## Backend — `/api/print/refresh-status`

**Method:** `POST`  
**Auth:** `X-Admin-Password` (כמו שאר ה-admin endpoints)  
**Body:** `{ "orderId": "<our DB id>" }`

**לוגיקה:**
1. שלוף מ-D1: `SELECT prodigi_order_id FROM print_orders WHERE id=?`
2. קרא ל-Gelato: `GET https://api.gelato.com/v2/order/status/{gelatoOrderId}` עם `X-API-KEY`
3. מפה `productionStatus` לסטטוס שלנו (אותו STATUS_MAP שב-webhook)
4. עדכן D1: `UPDATE print_orders SET status=? WHERE id=? AND status != 'cancelled'`
5. החזר `{ status, gelatoStatus, tracking }`

**Gelato status API:**
- URL: `https://api.gelato.com/v2/order/status/{orderReferenceId}`
- מחזיר: `productionStatus`, `orderItems[].status`, `trackingCode[]`

## Frontend — כפתור בכל שורה

- מוצג רק לשורות שה-status הוא `in_production` (לא shipped/cancelled)
- אייקון 🔄 קטן ליד ה-badge
- בלחיצה: הכפתור מציג spinner → קורא ל-endpoint → מעדכן badge בשורה
- toast: "סטטוס עודכן: shipped" אם השתנה, "אין שינוי בסטטוס" אם לא

## קבצים שישתנו
- `worker.js` — endpoint חדש `handlePrintRefreshStatus`
- `admin.html` — כפתור בשורה + JS לוגיקה
