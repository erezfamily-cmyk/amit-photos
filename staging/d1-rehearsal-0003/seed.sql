INSERT INTO photos VALUES ('photo-1', 'Photo One', 'photo-1.jpg');
INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, created_at) VALUES
 ('local-1','SYNTHORDER0001','digital','photo-1','large',10000,'ILS','COMPLETED','SYNTHCAPTURE01','tok-synth-1','2026-10-01T00:00:00Z'),
 ('local-2','SYNTHORDER0002','digital','photo-1','large',10000,'ILS','CREATED',NULL,NULL,'2026-10-02T00:00:00Z'),
 ('local-3','SYNTHORDER0003','digital','photo-1','large',10000,'ILS','FULFILLING','SYNTHCAPTURE03','tok-synth-3','2026-10-03T00:00:00Z');
INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES
 ('tok-synth-1','["photo-1"]','large',0,9999999999,1,'SYNTHCAPTURE01',100),
 ('tok-synth-2','["photo-1"]','large',1,9999999999,2,'SYNTHCAPTURE02',100),
 ('tok-synth-legacy','["photo-1"]','small',0,9999999999,3,NULL,19);
INSERT INTO paypal_webhook_events (event_id, event_type, received_at, processed) VALUES ('WH-SYNTH-1','PAYMENT.CAPTURE.COMPLETED','2026-10-01T00:00:01Z',1);
