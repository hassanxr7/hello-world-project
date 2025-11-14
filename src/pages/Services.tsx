import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { CreditCard, Smartphone, Building, Lock, Zap, HeadphonesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import merchantImage from "@/assets/merchant-woman.jpg";

const Services = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="pt-32 pb-16 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center space-y-6 animate-fade-in">
            <h1 className="text-5xl md:text-6xl font-bold text-foreground">
              Our <span className="text-primary">Services</span>
            </h1>
            <p className="text-xl text-muted-foreground">
              Complete Payment Solutions for Every Business in South Sudan
            </p>
          </div>
        </div>
      </section>

      {/* Main Services */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Payment Gateway */}
            <div className="bg-background border border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <CreditCard className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">Payment Gateway</h3>
              <p className="text-muted-foreground mb-6">
                Accept credit cards, debit cards, and digital payments through our secure, PCI-compliant gateway. Seamless integration with your website or app.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ Multiple currency support</li>
                <li>✓ Real-time transaction processing</li>
                <li>✓ Fraud detection & prevention</li>
                <li>✓ Detailed analytics dashboard</li>
              </ul>
            </div>

            {/* Mobile Money */}
            <div className="bg-background border border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <Smartphone className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">Mobile Money Integration</h3>
              <p className="text-muted-foreground mb-6">
                Connect with major mobile money providers across South Sudan. Enable your customers to pay with their mobile wallets instantly.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ MTN Mobile Money</li>
                <li>✓ Airtel Money</li>
                <li>✓ Instant settlement</li>
                <li>✓ Low transaction fees</li>
              </ul>
            </div>

            {/* Bank Transfers */}
            <div className="bg-background border border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <Building className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">Bank Transfers</h3>
              <p className="text-muted-foreground mb-6">
                Direct bank transfer integration with major South Sudanese banks. Secure and reliable payment collection.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ Local bank network</li>
                <li>✓ Automated reconciliation</li>
                <li>✓ Same-day settlement options</li>
                <li>✓ Bulk payment processing</li>
              </ul>
            </div>

            {/* Security */}
            <div className="bg-background border border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <Lock className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">Advanced Security</h3>
              <p className="text-muted-foreground mb-6">
                Enterprise-grade security protecting every transaction. PCI DSS compliant infrastructure with end-to-end encryption.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ 256-bit SSL encryption</li>
                <li>✓ Two-factor authentication</li>
                <li>✓ Fraud monitoring 24/7</li>
                <li>✓ Data protection compliance</li>
              </ul>
            </div>

            {/* Fast Settlement */}
            <div className="bg-background border border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <Zap className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">Fast Settlement</h3>
              <p className="text-muted-foreground mb-6">
                Get your funds quickly with our rapid settlement process. Choose from multiple settlement options to match your cash flow needs.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ T+1 settlement available</li>
                <li>✓ Flexible payout schedules</li>
                <li>✓ Automated transfers</li>
                <li>✓ Real-time balance tracking</li>
              </ul>
            </div>

            {/* Support */}
            <div className="bg-background border border-border rounded-lg p-8 hover:shadow-[var(--shadow-strong)] transition-all animate-fade-in">
              <HeadphonesIcon className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">24/7 Support</h3>
              <p className="text-muted-foreground mb-6">
                Dedicated support team available around the clock. Get help whenever you need it through multiple channels.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ Phone & email support</li>
                <li>✓ Live chat assistance</li>
                <li>✓ Technical documentation</li>
                <li>✓ Dedicated account manager</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Integration Section */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6 animate-fade-in">
              <h2 className="text-4xl font-bold text-foreground">
                Easy Integration
              </h2>
              <p className="text-lg text-muted-foreground">
                Get started quickly with our developer-friendly APIs and comprehensive documentation. Our Nebdex platform makes integration simple, whether you're running an e-commerce site, mobile app, or brick-and-mortar store.
              </p>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span>RESTful API with clear documentation</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span>SDKs for popular programming languages</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span>WordPress, Shopify, and custom plugins</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span>Test environment for development</span>
                </li>
              </ul>
              <Button 
                size="lg"
                className="bg-primary hover:bg-primary-dark text-primary-foreground"
                asChild
              >
                <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                  Start Integrating Now
                </a>
              </Button>
            </div>
            <div className="animate-fade-in">
              <img 
                src={merchantImage} 
                alt="Merchant using HubdexPay" 
                className="rounded-lg shadow-[var(--shadow-strong)] w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-6 animate-fade-in">
            <h2 className="text-4xl font-bold text-foreground">
              Ready to Get Started?
            </h2>
            <p className="text-xl text-muted-foreground">
              Join hundreds of businesses using HubdexPay to grow their revenue
            </p>
            <Button 
              size="lg"
              className="bg-primary hover:bg-primary-dark text-primary-foreground shadow-[var(--shadow-strong)] text-lg px-8"
              asChild
            >
              <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                Become a Merchant
              </a>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Services;
