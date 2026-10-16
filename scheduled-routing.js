// Which background jobs a Cloudflare cron trigger may start. Cloudflare passes the trigger's cron
// expression to scheduled() as event.cron, exactly as written in wrangler.toml.
//
//  - The two EXISTING triggers keep exactly the job set they have always run (nothing changes for
//    Pinterest, the newsletter draft generator, the welcome sequence or the mail retry).
//  - A frequent payment-monitoring trigger may ever start ONE job: the payment health check
//    (read-only D1 queries; alerts only when something is wrong). It can never start Pinterest,
//    the newsletter generator (AI calls) or any other job, however often it fires.
//  - An unknown expression (a new or edited trigger nobody classified) runs only the cheap
//    payment health check and is reported as unknown, so a new cron can never silently start the
//    expensive jobs, and an edited existing cron is noticed instead of silently doing nothing.
//
// This file adds no trigger: triggers live only in wrangler.toml. It imports nothing.

export const LEGACY_CRONS = ['0 */2 * * *', '0 9 1,15 * *'];
export const PAYMENT_MONITOR_CRON = '*/15 * * * *';

// Exactly the set the single scheduled() handler started on EVERY trigger before this routing existed.
export const LEGACY_JOBS = ['pinterest', 'newsletter', 'welcome', 'linkEmailRetry', 'paymentHealth'];

export function scheduledJobs(cron) {
  if (typeof cron === 'string' && LEGACY_CRONS.includes(cron)) return { kind: 'legacy', jobs: [...LEGACY_JOBS] };
  if (cron === PAYMENT_MONITOR_CRON) return { kind: 'payment-monitor', jobs: ['paymentHealth'] };
  return { kind: 'unknown', jobs: ['paymentHealth'] };
}
