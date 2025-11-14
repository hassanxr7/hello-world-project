import { Button } from "@/components/ui/button";
import { ArrowRight, Mail, Phone } from "lucide-react";

const CTA = () => {
  return (
    <section id="contact" className="py-24 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-[var(--gradient-hero)] opacity-10" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center space-y-8 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground">
            Ready to transform your{" "}
            <span className="text-primary">payment experience?</span>
          </h2>
          <p className="text-xl text-muted-foreground">
            Join hundreds of businesses across South Sudan using HubdexPay to grow their revenue
          </p>
          
          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <Button 
              size="lg"
              className="bg-primary hover:bg-primary-dark text-primary-foreground shadow-[var(--shadow-strong)] hover:scale-105 transition-all text-lg px-8 py-6 group"
              asChild
            >
              <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                Get Started Now
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>
            </Button>
            <Button 
              size="lg"
              variant="outline"
              className="border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground text-lg px-8 py-6"
              asChild
            >
              <a href="https://nebdex.com/login" target="_blank" rel="noopener noreferrer">
                Sign In
              </a>
            </Button>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6 pt-12 max-w-2xl mx-auto">
            <div className="flex items-center justify-center gap-3 text-muted-foreground">
              <Mail className="w-5 h-5 text-primary" />
              <a href="mailto:support@hubdexpay.com" className="hover:text-primary transition-colors">
                support@hubdexpay.com
              </a>
            </div>
            <div className="flex items-center justify-center gap-3 text-muted-foreground">
              <Phone className="w-5 h-5 text-primary" />
              <span>24/7 Support Available</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTA;
