import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-image.jpg";

const Hero = () => {
  return (
    <section id="home" className="relative min-h-screen flex items-center pt-20 overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      {/* Decorative elements */}
      <div className="absolute top-20 right-10 w-72 h-72 bg-primary/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 left-10 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-float" style={{ animationDelay: "1s" }} />
      
      <div className="container mx-auto px-4 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8 animate-fade-in">
            <div className="inline-block">
              <span className="text-sm font-semibold text-primary bg-primary/10 px-4 py-2 rounded-full">
                Simple. Transparent. Secure
              </span>
            </div>
            
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight text-foreground">
              The smart way to accept{" "}
              <span className="text-primary">online payments.</span>
            </h1>
            
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
              Grow with a secure, compliant payment gateway built for South Sudan—fast onboarding, 
              transparent pricing, and 24/7 support.
            </p>
            
            <div className="flex flex-wrap gap-4">
              <Button 
                size="lg"
                className="bg-primary hover:bg-primary-dark text-primary-foreground shadow-[var(--shadow-strong)] hover:scale-105 transition-all text-lg px-8 py-6"
                asChild
              >
                <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                  Open a Free Account
                </a>
              </Button>
              <Button 
                size="lg"
                variant="outline"
                className="border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground text-lg px-8 py-6 transition-all"
                asChild
              >
                <a href="#contact">
                  Contact Sales
                </a>
              </Button>
            </div>
            
            <div className="flex items-center gap-8 pt-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">99.9%</div>
                <div className="text-sm text-muted-foreground">Uptime</div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">24/7</div>
                <div className="text-sm text-muted-foreground">Support</div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">Fast</div>
                <div className="text-sm text-muted-foreground">Onboarding</div>
              </div>
            </div>
          </div>
          
          <div className="relative animate-slide-up lg:block hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent rounded-3xl blur-2xl" />
            <img 
              src={heroImage} 
              alt="HubdexPay Payment Solution" 
              className="relative rounded-3xl shadow-2xl w-full h-auto object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
