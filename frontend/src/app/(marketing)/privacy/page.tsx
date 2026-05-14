import { Shield } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white text-center border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <span className="label-caps text-brand-primary mb-6 block">Legal & Compliance</span>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
            Privacy <span className="text-brand-primary italic">Policy</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-warm-cream/60 leading-relaxed font-normal">
            Last Updated: January 15, 2024. Your data privacy is our highest priority.
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
                  <li><a href="#overview" className="hover:text-brand-primary transition-colors">Overview</a></li>
                  <li><a href="#data-collection" className="hover:text-brand-primary transition-colors">Data Collection</a></li>
                  <li><a href="#student-records" className="hover:text-brand-primary transition-colors">Student Records</a></li>
                  <li><a href="#security" className="hover:text-brand-primary transition-colors">Security</a></li>
                  <li><a href="#rights" className="hover:text-brand-primary transition-colors">User Rights</a></li>
                </ul>
              </nav>
            </aside>

            <div className="col-span-3 space-y-16">
              <div id="overview" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">1. Overview</h2>
                <p className="text-muted-text leading-relaxed mb-4">
                  ShuleHQ ("we," "our," or "us") is committed to protecting the privacy of school administrators, teachers, parents, and students. This Privacy Policy explains how we collect, use, and protect information within our school management system.
                </p>
                <p className="text-muted-text leading-relaxed">
                  We operate in strict accordance with the <strong className="text-dark-navy">Kenya Data Protection Act, 2019</strong>.
                </p>
              </div>

              <div id="data-collection" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">2. Data Collection</h2>
                <p className="text-muted-text leading-relaxed mb-6">We collect information necessary to provide school management services, including:</p>
                <ul className="space-y-4 text-muted-text">
                  <li><strong className="text-dark-navy">School Information:</strong> Name, address, registration details, and contact information.</li>
                  <li><strong className="text-dark-navy">Staff Information:</strong> Name, professional credentials, and system login credentials.</li>
                  <li><strong className="text-dark-navy">Parent Information:</strong> Contact details, M-Pesa phone numbers for fee reconciliation.</li>
                </ul>
              </div>

              <div id="student-records" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight flex items-center gap-4">
                  <Shield className="text-brand-primary" /> 3. Student Records
                </h2>
                <p className="text-muted-text leading-relaxed mb-6">
                  Student data is treated with the highest level of sensitivity. ShuleHQ acts as a <strong className="text-dark-navy">Data Processor</strong> for the school, which remains the <strong className="text-dark-navy">Data Controller</strong>.
                </p>
                <div className="bg-hero-gradient p-8 rounded-[2rem] border border-brand-border">
                  <h4 className="text-dark-navy font-bold mb-4">Zero Third-Party Sharing</h4>
                  <p className="text-sm text-muted-text">
                    We never sell, trade, or share student academic or personal records with third-party advertisers or data brokers under any circumstances.
                  </p>
                </div>
              </div>

              <div id="security" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">4. Security Measures</h2>
                <p className="text-muted-text leading-relaxed">
                  We implement industry-standard encryption (AES-256) for all data at rest and TLS for all data in transit. Access is controlled via strict Role-Based Access Control (RBAC).
                </p>
              </div>

              <div id="rights" className="scroll-mt-32">
                <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">5. Your Rights</h2>
                <p className="text-muted-text leading-relaxed mb-4">
                  Under the Kenya Data Protection Act, users have the right to access their data, request corrections, and request deletion (Right to be Forgotten), subject to mandatory school record retention laws.
                </p>
                <p className="text-sm text-muted-text italic mt-8">
                  For any privacy-related inquiries, please contact our Data Protection Officer at <strong>dpo@shulehq.co.ke</strong>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
