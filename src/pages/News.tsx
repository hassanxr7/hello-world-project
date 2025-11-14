import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Calendar, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const News = () => {
  const newsArticles = [
    {
      id: 1,
      title: "HubdexPay Expands Payment Solutions Across South Sudan",
      date: "January 15, 2025",
      excerpt: "HubdexPay Ltd announces major expansion of payment gateway services, now serving over 500 merchants across South Sudan with secure digital payment solutions.",
      category: "Company News"
    },
    {
      id: 2,
      title: "Nebdex Platform Processes 1 Million Transactions",
      date: "December 20, 2024",
      excerpt: "The Nebdex payment platform reaches a major milestone, processing over 1 million successful transactions for South Sudanese businesses.",
      category: "Milestone"
    },
    {
      id: 3,
      title: "New Mobile Money Integration Launched",
      date: "November 30, 2024",
      excerpt: "HubdexPay introduces seamless integration with MTN Mobile Money and Airtel Money, making digital payments more accessible to customers.",
      category: "Product Update"
    },
    {
      id: 4,
      title: "Partnership with Major South Sudanese Banks",
      date: "November 10, 2024",
      excerpt: "HubdexPay announces strategic partnerships with leading banks to enhance direct bank transfer capabilities and faster settlements.",
      category: "Partnership"
    },
    {
      id: 5,
      title: "24/7 Support Center Now Live",
      date: "October 25, 2024",
      excerpt: "Merchants can now access round-the-clock support through phone, email, and live chat, ensuring business continuity at all times.",
      category: "Service Update"
    },
    {
      id: 6,
      title: "HubdexPay Wins South Sudan Fintech Innovation Award",
      date: "October 5, 2024",
      excerpt: "Recognized for excellence in digital payment solutions and contribution to South Sudan's growing fintech ecosystem.",
      category: "Award"
    }
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="pt-32 pb-16 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center space-y-6 animate-fade-in">
            <h1 className="text-5xl md:text-6xl font-bold text-foreground">
              Latest <span className="text-primary">News & Updates</span>
            </h1>
            <p className="text-xl text-muted-foreground">
              Stay informed about HubdexPay's growth, new features, and industry insights
            </p>
          </div>
        </div>
      </section>

      {/* News Grid */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {newsArticles.map((article) => (
              <div 
                key={article.id}
                className="bg-background border border-border rounded-lg overflow-hidden hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in group"
              >
                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>{article.date}</span>
                  </div>
                  <div className="inline-block px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-semibold">
                    {article.category}
                  </div>
                  <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors">
                    {article.title}
                  </h3>
                  <p className="text-muted-foreground">
                    {article.excerpt}
                  </p>
                  <button className="flex items-center gap-2 text-primary font-semibold group-hover:gap-3 transition-all">
                    Read More <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter Signup */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center space-y-6 animate-fade-in">
            <h2 className="text-3xl font-bold text-foreground">
              Stay Updated
            </h2>
            <p className="text-muted-foreground">
              Subscribe to our newsletter and never miss important updates about HubdexPay
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <input 
                type="email" 
                placeholder="Enter your email" 
                className="px-4 py-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button 
                className="bg-primary hover:bg-primary-dark text-primary-foreground"
              >
                Subscribe
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Media Kit */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-6 animate-fade-in">
            <h2 className="text-3xl font-bold text-foreground">
              Media & Press
            </h2>
            <p className="text-muted-foreground">
              For media inquiries, press releases, or partnership opportunities, please contact our communications team.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Button 
                variant="outline"
                className="border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                asChild
              >
                <a href="mailto:press@hubdexpay.com">
                  Press Inquiries
                </a>
              </Button>
              <Button 
                variant="outline"
                className="border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
              >
                Download Media Kit
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default News;
