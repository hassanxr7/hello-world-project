import { CreditCard, TrendingUp, Users, Shield, Zap, Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";

const Features = () => {
  const { t } = useLanguage();
  
  const features = [
    {
      icon: CreditCard,
      title: t("feature1Title"),
      description: t("feature1Desc"),
      color: "text-primary"
    },
    {
      icon: TrendingUp,
      title: t("feature2Title"),
      description: t("feature2Desc"),
      color: "text-secondary"
    },
    {
      icon: Users,
      title: t("feature3Title"),
      description: t("feature3Desc"),
      color: "text-primary"
    },
    {
      icon: Shield,
      title: t("feature4Title"),
      description: t("feature4Desc"),
      color: "text-secondary"
    },
    {
      icon: Zap,
      title: t("feature5Title"),
      description: t("feature5Desc"),
      color: "text-primary"
    },
    {
      icon: Globe,
      title: t("feature6Title"),
      description: t("feature6Desc"),
      color: "text-secondary"
    }
  ];
  
  return (
    <section id="services" className="py-24 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center space-y-4 mb-16 animate-fade-in">
          <span className="text-sm font-semibold text-primary bg-primary/10 px-4 py-2 rounded-full inline-block">
            What we do
          </span>
          <h2 className="text-4xl md:text-5xl font-bold text-foreground">
            {t("featuresTitle")}
          </h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            {t("featuresSubtitle")}
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
