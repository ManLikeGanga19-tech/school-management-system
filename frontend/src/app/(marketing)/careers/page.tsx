import { Briefcase, Clock, Star } from "lucide-react";

export default function CareersPage() {
  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-dark-navy text-white text-center border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <span className="label-caps text-brand-primary mb-6 block">Join the Team</span>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight mb-8 leading-tight">
            Help us build the future <br className="hidden md:block" /> of{" "}
            <span className="text-brand-primary italic">Kenyan Education</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-warm-cream/60 leading-relaxed font-normal">
            ShuleHQ is an early-stage product. We are not hiring right now, but we are always open to hearing from exceptional people who care about Kenyan schools.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-12">
            {[
              { title: "Impact First", desc: "Every contribution directly helps a school director save hours of paperwork, letting them focus on what matters — teaching children.", icon: Star },
              { title: "Local Excellence", desc: "We are proud to be building Kenyan solutions for Kenyan challenges. No 'localized' Western templates here.", icon: Briefcase },
              { title: "Growth Mindset", desc: "We move fast, we learn fast. You'll have the autonomy to own your work and grow your skills exponentially.", icon: Clock },
            ].map((benefit, i) => (
              <div key={i} className="group">
                <div className="w-12 h-12 bg-teal-accent text-deep-teal rounded-xl flex items-center justify-center mb-6 group-hover:bg-brand-primary group-hover:text-white transition-all shadow-sm">
                  <benefit.icon size={24} />
                </div>
                <h3 className="text-xl font-bold text-dark-navy mb-4 tracking-tight">{benefit.title}</h3>
                <p className="text-muted-text leading-relaxed font-normal">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-page-bg">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl font-bold text-dark-navy mb-6 tracking-tight">Open Positions</h2>
          <p className="text-muted-text text-lg font-normal mb-16">
            No formal openings at this time. We are a lean, early-stage team. When we do hire, we will post here first.
          </p>

          <div className="ds-card bg-white p-12 border-brand-border text-center">
            <p className="text-muted-text font-medium text-lg mb-2">No open roles right now.</p>
            <p className="text-muted-text font-normal text-sm">Check back soon — or send us an open application below.</p>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white">
        <div className="max-w-7xl mx-auto bg-dark-navy rounded-[3rem] p-12 md:p-20 text-white text-center shadow-2xl relative overflow-hidden">
          <h2 className="text-4xl font-bold mb-8 relative z-10 tracking-tight">Think you belong here?</h2>
          <p className="text-warm-cream/60 text-lg mb-12 relative z-10 font-normal">
            We are always open to hearing from engineers, educators, and operators who care deeply about Kenyan schools.
          </p>
          <a
            href="mailto:careers@shulehq.co.ke?subject=Open%20Application%20%E2%80%94%20ShuleHQ&body=Hi%20Daniel%2C%0A%0AName%3A%20%0ARole%20interested%20in%3A%20%0ALinkedIn%20%2F%20Portfolio%3A%20%0A%0AWhy%20I%20want%20to%20join%20ShuleHQ%3A%0A"
            className="btn-dark-section px-12 py-5 text-xl relative z-10"
          >
            Send an Open Application
          </a>
        </div>
      </section>
    </div>
  );
}
