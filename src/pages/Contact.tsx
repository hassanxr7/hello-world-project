import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Mail, Phone, MapPin, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

const Contact = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="pt-32 pb-16 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center space-y-6 animate-fade-in">
            <h1 className="text-5xl md:text-6xl font-bold text-foreground">
              Get in <span className="text-primary">Touch</span>
            </h1>
            <p className="text-xl text-muted-foreground">
              We're here to help. Reach out to our team anytime.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Info & Form */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 max-w-6xl mx-auto">
            {/* Contact Information */}
            <div className="space-y-8 animate-fade-in">
              <div>
                <h2 className="text-3xl font-bold text-foreground mb-6">
                  Contact Information
                </h2>
                <p className="text-muted-foreground mb-8">
                  Our team is available 24/7 to assist you with any questions about our payment gateway services.
                </p>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Email Us</h3>
                    <a href="mailto:support@hubdexpay.com" className="text-muted-foreground hover:text-primary transition-colors">
                      support@hubdexpay.com
                    </a>
                    <br />
                    <a href="mailto:sales@hubdexpay.com" className="text-muted-foreground hover:text-primary transition-colors">
                      sales@hubdexpay.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Phone className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Call Us</h3>
                    <p className="text-muted-foreground">+211 XXX XXX XXX</p>
                    <p className="text-sm text-muted-foreground mt-1">Available 24/7</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Visit Us</h3>
                    <p className="text-muted-foreground">
                      HubdexPay Ltd<br />
                      Juba, South Sudan
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Clock className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Business Hours</h3>
                    <p className="text-muted-foreground">
                      24/7 Support Available<br />
                      Office: Mon-Fri, 8AM-6PM EAT
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-6">
                <h3 className="font-semibold text-foreground mb-4">Quick Actions</h3>
                <div className="flex flex-wrap gap-3">
                  <Button 
                    className="bg-primary hover:bg-primary-dark text-primary-foreground"
                    asChild
                  >
                    <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                      Become a Merchant
                    </a>
                  </Button>
                  <Button 
                    variant="outline"
                    className="border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                  >
                    Schedule a Demo
                  </Button>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="bg-muted/30 p-8 rounded-lg animate-fade-in">
              <h3 className="text-2xl font-bold text-foreground mb-6">Send Us a Message</h3>
              <form className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Full Name *
                  </label>
                  <input 
                    type="text" 
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Email Address *
                  </label>
                  <input 
                    type="email" 
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="your@email.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Phone Number
                  </label>
                  <input 
                    type="tel" 
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="+211 XXX XXX XXX"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Subject *
                  </label>
                  <input 
                    type="text" 
                    required
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="How can we help?"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Message *
                  </label>
                  <textarea 
                    required
                    rows={5}
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    placeholder="Tell us more about your inquiry..."
                  />
                </div>

                <Button 
                  type="submit"
                  className="w-full bg-primary hover:bg-primary-dark text-primary-foreground"
                  size="lg"
                >
                  Send Message
                </Button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-center text-foreground mb-12 animate-fade-in">
              Common Questions
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-lg font-bold text-foreground mb-2">How do I register as a merchant?</h3>
                <p className="text-muted-foreground text-sm">
                  Visit <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">nebdex.com/merchant/register</a> to create your account in minutes.
                </p>
              </div>
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-lg font-bold text-foreground mb-2">What documents do I need?</h3>
                <p className="text-muted-foreground text-sm">
                  Business registration, ID verification, and bank account details for settlement.
                </p>
              </div>
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-lg font-bold text-foreground mb-2">How long is the approval process?</h3>
                <p className="text-muted-foreground text-sm">
                  Most applications are approved within 24-48 hours after document verification.
                </p>
              </div>
              <div className="bg-background p-6 rounded-lg animate-fade-in">
                <h3 className="text-lg font-bold text-foreground mb-2">Do you offer technical support?</h3>
                <p className="text-muted-foreground text-sm">
                  Yes, we provide 24/7 technical support via phone, email, and live chat.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Contact;
