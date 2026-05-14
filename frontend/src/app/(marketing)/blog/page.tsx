import Link from "next/link";
import { BookOpen, Send } from "lucide-react";
import { BlogSubscribeForm } from "@/components/marketing/BlogSubscribeForm";

const posts = [
  {
    id: 1,
    title: "How to Transition Your Private School to CBC Without the Paperwork Headache",
    excerpt: "The shift from 8-4-4 to CBC doesn't have to be overwhelming. Learn how digital assessment tools can save your teachers hundreds of hours.",
    category: "CBC Excellence",
    author: "Daniel Oganga",
    date: "May 10, 2024",
    readTime: "8 min read",
  },
  {
    id: 2,
    title: "Digital Fee Collection: 5 Common Myths Kenyan Directors Believe",
    excerpt: "Think cash is safer? Think parents won't use a portal? We debunk the biggest myths about school fee automation in East Africa.",
    category: "School Finance",
    author: "Daniel Oganga",
    date: "April 28, 2024",
    readTime: "6 min read",
  },
  {
    id: 3,
    title: "Security Spotlight: How ShuleHQ Protects Your Learners' Data",
    excerpt: "Child data protection is more than just a policy — it's built into every line of code we write and every server we manage.",
    category: "Technology",
    author: "Daniel Oganga",
    date: "April 15, 2024",
    readTime: "10 min read",
  },
];

const categories = ["All", "CBC Excellence", "School Finance", "Technology", "Parent Engagement"];

export default function BlogPage() {
  return (
    <div className="bg-page-bg">
      <section className="pt-32 pb-20 bg-dark-navy text-white border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <span className="label-caps text-brand-primary mb-6 block">The ShuleHQ Journal</span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-8 leading-tight">
            Insights for the <br className="hidden md:block" />{" "}
            <span className="text-brand-primary italic">Modern Kenyan Educator</span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-warm-cream/60 leading-relaxed font-normal">
            Weekly guides on CBC implementation, financial integrity, and school management best practices.
          </p>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap justify-center gap-2 mb-16 pb-8 border-b border-brand-border">
            {categories.map((cat, i) => (
              <span
                key={i}
                className={`px-6 py-2 rounded-full text-sm font-bold label-caps cursor-default ${
                  i === 0
                    ? "bg-brand-primary text-white shadow-lg"
                    : "bg-white border border-brand-border text-muted-text shadow-sm"
                }`}
              >
                {cat}
              </span>
            ))}
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {posts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.id}`}
                className="ds-card flex flex-col group hover:shadow-xl hover:-translate-y-1 transition-all bg-white"
              >
                <div className="aspect-[16/10] bg-muted-warm overflow-hidden flex items-center justify-center p-8 border-b border-brand-border group-hover:bg-page-bg transition-colors">
                  <BookOpen size={40} className="text-brand-border opacity-40" />
                </div>
                <div className="p-8 flex-1 flex flex-col">
                  <div className="flex items-center gap-4 mb-6">
                    <span className="ds-badge bg-teal-accent text-deep-teal">{post.category}</span>
                    <span className="text-[10px] text-muted-text font-bold uppercase tracking-widest">{post.readTime}</span>
                  </div>
                  <h3 className="text-xl font-bold text-dark-navy mb-4 group-hover:text-brand-primary transition-colors leading-snug tracking-tight">
                    {post.title}
                  </h3>
                  <p className="text-muted-text text-sm mb-8 line-clamp-3 leading-relaxed font-normal">{post.excerpt}</p>
                  <div className="mt-auto pt-6 border-t border-brand-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-brand-primary/10 text-brand-primary rounded-full flex items-center justify-center font-bold text-[10px]">
                        {post.author.split(" ").map((n) => n[0]).join("")}
                      </div>
                      <span className="text-sm font-bold text-dark-navy">{post.author}</span>
                    </div>
                    <span className="text-[10px] text-muted-text font-bold uppercase tracking-widest leading-none">{post.date}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-20 text-center">
            <p className="text-sm text-muted-text font-medium">More articles coming soon.</p>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-page-bg border-t border-brand-border">
        <div className="max-w-4xl mx-auto ds-card bg-white p-12 md:p-20 text-center shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Send size={120} className="text-brand-primary" />
          </div>
          <h2 className="text-3xl font-bold text-dark-navy mb-6 tracking-tight">Get weekly school management tips</h2>
          <p className="text-muted-text text-lg mb-10 font-normal leading-relaxed">
            Join school directors who receive our "CBC Clarity" newsletter every Tuesday.
          </p>
          <BlogSubscribeForm />
          <p className="mt-6 text-[10px] text-muted-text font-bold uppercase tracking-widest">Zero spam. Unsubscribe anytime.</p>
        </div>
      </section>
    </div>
  );
}
