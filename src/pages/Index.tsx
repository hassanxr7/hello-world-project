import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
import ChatBot from "@/components/ChatBot";
import WelcomeNotice from "@/components/WelcomeNotice";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Hero />
      <Features />
      <CTA />
      <Footer />
      <ChatBot />
      <WelcomeNotice />
    </div>
  );
};

export default Index;
