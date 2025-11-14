import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Building2, Target, Users, Globe } from "lucide-react";
import teamImage from "@/assets/team-southsudan.jpg";

const About = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero Section */}
      <section className="pt-32 pb-16 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center space-y-6 animate-fade-in">
            <h1 className="text-5xl md:text-6xl font-bold text-foreground">
              About <span className="text-primary">HubdexPay Ltd</span>
            </h1>
            <p className="text-xl text-muted-foreground">
              South Sudan's Premier Payment Gateway Solution
            </p>
          </div>
        </div>
      </section>

      {/* Company Overview */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6 animate-fade-in">
              <h2 className="text-4xl font-bold text-foreground">
                Who We Are
              </h2>
              <p className="text-lg text-muted-foreground">
                HubdexPay Ltd is a registered payment gateway company in South Sudan, dedicated to transforming digital payments across the Horn of Africa region. We provide secure, compliant, and innovative payment solutions that empower businesses to grow in the digital economy.
              </p>
              <p className="text-lg text-muted-foreground">
                Our flagship platform, <a href="https://nebdex.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Nebdex.com</a>, powers thousands of transactions daily, helping merchants accept payments seamlessly while ensuring the highest standards of security and compliance.
              </p>
            </div>
            <div className="animate-fade-in">
              <img 
                src={teamImage} 
                alt="HubdexPay Team" 
                className="rounded-lg shadow-[var(--shadow-strong)] w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-background p-8 rounded-lg shadow-[var(--shadow-soft)] animate-fade-in">
              <Target className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">Our Mission</h3>
              <p className="text-muted-foreground">
                To provide accessible, secure, and innovative payment solutions that enable businesses across South Sudan and the Horn of Africa to participate fully in the digital economy.
              </p>
            </div>
            <div className="bg-background p-8 rounded-lg shadow-[var(--shadow-soft)] animate-fade-in">
              <Globe className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-2xl font-bold text-foreground mb-4">Our Vision</h3>
              <p className="text-muted-foreground">
                To become the most trusted and widely-used payment gateway in the Horn of Africa, driving financial inclusion and economic growth through technology.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Values */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center text-foreground mb-12 animate-fade-in">
            Our Core Values
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Building2 className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Trust & Security</h3>
              <p className="text-muted-foreground">
                We prioritize the security of every transaction and the trust of our merchants and customers.
              </p>
            </div>
            <div className="text-center space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Customer First</h3>
              <p className="text-muted-foreground">
                Our customers' success is our success. We provide 24/7 support and continuous innovation.
              </p>
            </div>
            <div className="text-center space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Globe className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Regional Focus</h3>
              <p className="text-muted-foreground">
                Built specifically for the Horn of Africa, understanding local needs and challenges.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Registration Info */}
      <section className="py-16 bg-primary/5">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-6 animate-fade-in">
            <h2 className="text-3xl font-bold text-foreground">
              Registered & Compliant
            </h2>
            <p className="text-lg text-muted-foreground">
              HubdexPay Ltd is officially registered in South Sudan and operates in full compliance with local and international payment regulations. We maintain the highest standards of financial security and data protection.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default About;
