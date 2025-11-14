import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const Pricing = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="pt-32 pb-16 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center space-y-6 animate-fade-in">
            <h1 className="text-5xl md:text-6xl font-bold text-foreground">
              Simple, <span className="text-primary">Transparent Pricing</span>
            </h1>
            <p className="text-xl text-muted-foreground">
              No hidden fees. Pay only for what you use.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Starter Plan */}
            <div className="bg-background border-2 border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <h3 className="text-2xl font-bold text-foreground mb-2">Starter</h3>
              <p className="text-muted-foreground mb-6">Perfect for small businesses</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">2.9%</span>
                <span className="text-muted-foreground"> + SSP 50</span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">Per successful transaction</p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">All payment methods</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">Dashboard analytics</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">Email support</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">T+2 settlement</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">API access</span>
                </li>
              </ul>
              <Button 
                className="w-full border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                variant="outline"
                asChild
              >
                <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                  Get Started
                </a>
              </Button>
            </div>

            {/* Business Plan - Featured */}
            <div className="bg-primary text-primary-foreground rounded-lg p-8 shadow-[var(--shadow-strong)] transform md:scale-105 animate-fade-in relative">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-secondary text-secondary-foreground px-4 py-1 rounded-full text-sm font-semibold">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold mb-2">Business</h3>
              <p className="text-primary-foreground/80 mb-6">For growing companies</p>
              <div className="mb-6">
                <span className="text-4xl font-bold">2.4%</span>
                <span className="text-primary-foreground/80"> + SSP 50</span>
              </div>
              <p className="text-sm text-primary-foreground/80 mb-6">Per successful transaction</p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Everything in Starter</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Priority support 24/7</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>T+1 settlement</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Advanced analytics</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Dedicated account manager</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>Custom integration support</span>
                </li>
              </ul>
              <Button 
                className="w-full bg-background text-primary hover:bg-background/90"
                asChild
              >
                <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                  Get Started
                </a>
              </Button>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-background border-2 border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <h3 className="text-2xl font-bold text-foreground mb-2">Enterprise</h3>
              <p className="text-muted-foreground mb-6">For large organizations</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-foreground">Custom</span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">Tailored to your needs</p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">Everything in Business</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">Volume discounts</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">Same-day settlement</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">White-label solutions</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">SLA guarantees</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">Custom reporting</span>
                </li>
              </ul>
              <Button 
                className="w-full border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                variant="outline"
                asChild
              >
                <a href="mailto:sales@hubdexpay.com">
                  Contact Sales
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Additional Info */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-center text-foreground mb-12 animate-fade-in">
              Frequently Asked Questions
            </h2>
            <div className="space-y-6">
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-xl font-bold text-foreground mb-2">Are there any setup fees?</h3>
                <p className="text-muted-foreground">No, we don't charge any setup or monthly fees. You only pay per transaction.</p>
              </div>
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-xl font-bold text-foreground mb-2">What payment methods do you support?</h3>
                <p className="text-muted-foreground">We support credit/debit cards (Visa, Mastercard), mobile money (MTN, Airtel), and direct bank transfers.</p>
              </div>
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-xl font-bold text-foreground mb-2">How long does settlement take?</h3>
                <p className="text-muted-foreground">Settlement times vary by plan: T+2 for Starter, T+1 for Business, and same-day options for Enterprise.</p>
              </div>
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-xl font-bold text-foreground mb-2">Can I change my plan later?</h3>
                <p className="text-muted-foreground">Yes, you can upgrade or adjust your plan at any time based on your transaction volume.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Pricing;
