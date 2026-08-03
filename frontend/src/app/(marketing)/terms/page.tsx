import { FileText } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white text-center border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <span className="label-caps text-brand-primary mb-6 block">Legal &amp; Compliance</span>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
            Terms of <span className="text-brand-primary italic">Service</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-warm-cream/60 leading-relaxed font-normal">
            The terms that govern schools&apos; use of the ShuleHQ platform.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12">
            <aside className="hidden md:block col-span-1">
              <nav className="sticky top-32 space-y-4">
                <p className="label-caps text-muted-text text-[10px]">Sections</p>
                <ul className="space-y-2 text-sm font-bold text-muted-text">
                  <li><a href="#agreement" className="hover:text-brand-primary transition-colors">Agreement</a></li>
                  <li><a href="#accounts" className="hover:text-brand-primary transition-colors">Accounts</a></li>
                  <li><a href="#acceptable-use" className="hover:text-brand-primary transition-colors">Acceptable Use</a></li>
                  <li><a href="#data" className="hover:text-brand-primary transition-colors">Your Data</a></li>
                  <li><a href="#billing" className="hover:text-brand-primary transition-colors">Billing</a></li>
                  <li><a href="#availability" className="hover:text-brand-primary transition-colors">Availability</a></li>
                </ul>
              </nav>
            </aside>

            <div className="col-span-3 space-y-16">
              <div id="agreement" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">1. Agreement</h2>
                <p className="text-muted-text leading-relaxed mb-4">
                  These Terms of Service ("Terms") govern your school&apos;s access to and use of the ShuleHQ
                  school management platform ("the Service"). By signing in or using the Service, the school
                  and its authorised users agree to these Terms.
                </p>
                <p className="text-muted-text leading-relaxed">
                  ShuleHQ is operated in Kenya and these Terms are governed by Kenyan law, including the
                  <strong className="text-dark-navy"> Kenya Data Protection Act, 2019</strong>.
                </p>
              </div>

              <div id="accounts" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">2. Accounts &amp; Access</h2>
                <ul className="space-y-4 text-muted-text">
                  <li><strong className="text-dark-navy">School responsibility:</strong> Each school controls its own users. The school&apos;s director is responsible for creating, disabling, and resetting staff accounts.</li>
                  <li><strong className="text-dark-navy">Credentials:</strong> Users must keep their passwords confidential. If you cannot access your account, contact your school administrator, who can reset it.</li>
                  <li><strong className="text-dark-navy">Isolation:</strong> Each school&apos;s workspace and data are logically isolated from every other school on the platform.</li>
                </ul>
              </div>

              <div id="acceptable-use" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight flex items-center gap-4">
                  <FileText className="text-brand-primary" /> 3. Acceptable Use
                </h2>
                <p className="text-muted-text leading-relaxed mb-6">
                  You agree not to misuse the Service. In particular, you will not attempt to access another
                  school&apos;s data, disrupt the platform, or upload unlawful content. Accounts are for the
                  school&apos;s legitimate administrative use.
                </p>
              </div>

              <div id="data" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">4. Your Data</h2>
                <p className="text-muted-text leading-relaxed mb-6">
                  The school remains the <strong className="text-dark-navy">Data Controller</strong> of its records;
                  ShuleHQ acts as the <strong className="text-dark-navy">Data Processor</strong>. We handle personal
                  data as described in our <a href="/privacy" className="text-brand-primary hover:underline font-medium">Privacy Policy</a>,
                  which forms part of these Terms.
                </p>
                <div className="bg-hero-gradient p-8 rounded-[2rem] border border-brand-border">
                  <h4 className="text-dark-navy font-bold mb-4">You own your records</h4>
                  <p className="text-sm text-muted-text">
                    Your school&apos;s data belongs to your school. You can request an export at any time, and we
                    never sell or share student records with advertisers or data brokers.
                  </p>
                </div>
              </div>

              <div id="billing" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">5. Subscription &amp; Billing</h2>
                <p className="text-muted-text leading-relaxed">
                  Paid plans are billed per the pricing agreed with your school. Fees are non-refundable except
                  where required by law. We will give reasonable notice of any change to pricing or plan terms.
                </p>
              </div>

              <div id="availability" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">6. Availability &amp; Liability</h2>
                <p className="text-muted-text leading-relaxed mb-4">
                  We work hard to keep the Service available and secure, but it is provided on an "as is" basis
                  without warranties of uninterrupted availability. To the extent permitted by law, ShuleHQ&apos;s
                  liability is limited to the fees paid for the Service in the preceding three months.
                </p>
                <p className="text-sm text-muted-text italic mt-8">
                  Questions about these Terms? Contact us at <strong>support@shulehq.co.ke</strong>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
