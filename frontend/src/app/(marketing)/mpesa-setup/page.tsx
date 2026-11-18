import Link from "next/link";
import { Smartphone, Check, Zap, Info } from "lucide-react";

export default function MpesaSetupPage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center gap-16">
          <div className="md:w-1/2">
            <span className="ds-badge bg-brand-primary text-white mb-6">Payments Solution</span>
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
              Every M-Pesa Payment <br /> <span className="text-brand-primary italic">Recorded &amp; Verified</span>
            </h1>
            <p className="max-w-xl text-xl text-warm-cream/60 leading-relaxed font-normal mb-10">
              Parents keep paying the way they already do. Your bursar records each payment once, the balance updates instantly, and the parent gets an SMS receipt.
            </p>
            <Link href="/contact" className="btn-dark-section px-10 py-5 text-lg">
              Get Started with M-Pesa
            </Link>
          </div>
          <div className="md:w-1/2 relative group">
            <div className="absolute -inset-4 bg-brand-primary/10 rounded-[3rem] blur-3xl opacity-50 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative ds-card border-white/10 bg-white/5 backdrop-blur-md aspect-video flex items-center justify-center p-12 text-center text-warm-cream/30 italic group-hover:border-brand-primary/30 transition-all">
              <div className="flex flex-col items-center gap-4">
                <Smartphone size={48} className="opacity-20" />
                <p>Payment recorded → balance updated → SMS receipt sent</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-bold text-dark-navy mb-4 tracking-tight">How Fee Payments Work</h2>
            <p className="text-muted-text max-w-2xl mx-auto font-normal">ShuleHQ never touches your school's money. Fees go straight to your own Paybill, Till or bank account, and ShuleHQ keeps the record.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "1. Parents pay as usual",
                desc: "Parents pay through your school's own channels: your M-Pesa Paybill or Till, a bank deposit, or cash at the office.",
                features: ["Your own Paybill, Till or bank", "No new accounts for parents", "ShuleHQ never holds funds"],
              },
              {
                title: "2. Your office records it",
                desc: "Your bursar, secretary or finance office records the payment once, by M-Pesa transaction code or by scanning the receipt. The learner's balance updates immediately.",
                features: ["Recorded once, in one ledger", "Cash, M-Pesa, bank & cheque", "Full audit log"],
              },
              {
                title: "3. Parents get proof",
                desc: "The parent receives an SMS receipt straight away, and can verify any payment by phone number or M-Pesa code on the parent portal.",
                features: ["Instant SMS receipt", "QR-verified PDF receipts", "Fewer fee disputes"],
              },
            ].map((method, i) => (
              <div key={i} className="ds-card p-10 border-brand-border bg-page-bg/30 hover:bg-white transition-all group shadow-sm">
                <h3 className="text-2xl font-bold text-dark-navy mb-4 tracking-tight">{method.title}</h3>
                <p className="text-muted-text mb-8 font-normal leading-relaxed">{method.desc}</p>
                <ul className="space-y-4">
                  {method.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-3 text-dark-navy font-bold tracking-tight text-sm">
                      <div className="bg-teal-accent p-1 rounded-md text-deep-teal"><Check size={14} /></div>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-warm-cream">
        <div className="max-w-4xl mx-auto">
          <div className="ds-card bg-white p-12 border-brand-border shadow-2xl">
            <div className="flex items-center gap-4 mb-10">
              <div className="w-12 h-12 bg-brand-primary rounded-xl flex items-center justify-center text-white">
                <Zap size={24} />
              </div>
              <h2 className="text-3xl font-bold text-dark-navy tracking-tight">Setup Requirements</h2>
            </div>
            <div className="space-y-8">
              {[
                { n: "1", title: "Your existing payment details", desc: "Your school's Paybill, Till or bank account stays exactly as it is. No Safaricom API setup is needed." },
                { n: "2", title: "Fee structures and learners", desc: "We load your classes, learners, parent phone numbers and fee structures, so every payment has a balance to update." },
                { n: "3", title: "Who records payments", desc: "Choose who records payments at your school (bursar, secretary or finance office) and we set up their accounts and train them." },
              ].map((step, i) => (
                <div key={i} className="flex gap-6">
                  <div className="w-8 h-8 rounded-full bg-page-bg text-dark-navy flex items-center justify-center font-bold text-sm shrink-0">{step.n}</div>
                  <div>
                    <h4 className="font-bold text-dark-navy mb-1 tracking-tight">{step.title}</h4>
                    <p className="text-muted-text text-sm font-normal">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-12 p-6 bg-deep-teal/5 rounded-2xl border border-deep-teal/10 flex gap-4">
              <Info className="text-deep-teal shrink-0" size={24} />
              <p className="text-sm text-deep-teal/80 font-medium">
                <strong>Moving from a receipt book or spreadsheet?</strong> We import your existing learner list and fee balances during setup, so you start the term with correct balances.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white text-center">
        <h2 className="text-4xl font-bold text-dark-navy mb-8 tracking-tight">Stop checking SMS on the office phone.</h2>
        <Link href="/contact" className="btn-primary px-12 py-5 text-xl shadow-2xl shadow-brand-primary/20">
          Get Started for free
        </Link>
      </section>
    </div>
  );
}
