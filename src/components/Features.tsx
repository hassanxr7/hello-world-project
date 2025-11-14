import { CreditCard, TrendingUp, Users, Shield, Zap, Globe } from "lucide-react";
import { Card } from "@/components/ui/card";

const features = [
  {
    icon: CreditCard,
    title: "Payment Solution",
    description: "Accept cards, mobile money, and bank transfers through one reliable platform and dashboard.",
    color: "text-primary"
  },
  {
    icon: TrendingUp,
    title: "Growth Business",
    description: "Boost conversion with seamless checkout, recurring billing, and intelligent fraud protection.",
    color: "text-secondary"
  },
  {
    icon: Users,
    title: "Connected People",
    description: "Connect customers, merchants, and partners—pay and get paid anywhere, anytime.",
    color: "text-primary"
  },
  {
    icon: Shield,
    title: "Secure & Compliant",
    description: "Bank-level security with PCI DSS compliance and advanced encryption for all transactions.",
    color: "text-secondary"
  },
  {
    icon: Zap,
    title: "Instant Settlement",
    description: "Fast payouts with real-time transaction monitoring and automated reconciliation.",
    color: "text-primary"
  },
  {
    icon: Globe,
    title: "Built for South Sudan",
    description: "Tailored for the South Sudanese market with local payment methods and currency support.",
    color: "text-secondary"
  }
];

const Features = () => {
  return (
    <section id="services" className="py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center space-y-4 mb-16 animate-fade-in">
          <span className="text-sm font-semibold text-primary bg-primary/10 px-4 py-2 rounded-full inline-block">
            What we do
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground">
            Powering smart payments across{" "}
            <span className="text-primary">South Sudan</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Everything you need to accept payments and grow your business in one powerful platform
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card 
                key={index}
                className="p-8 hover:shadow-[var(--shadow-strong)] transition-all duration-300 hover:-translate-y-2 border-border/50 bg-card animate-slide-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${
                  feature.color === "text-primary" 
                    ? "from-primary/20 to-primary/5" 
                    : "from-secondary/20 to-secondary/5"
                } flex items-center justify-center mb-6`}>
                  <Icon className={`w-7 h-7 ${feature.color}`} />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Features;
