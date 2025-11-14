import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import logo from "@/assets/hubdexpay-logo-new.png";

const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-b border-border/50 shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src={logo} alt="HubdexPay Logo" className="h-20 md:h-24 w-auto" />
          </Link>
          
          <nav className="hidden lg:flex items-center gap-8">
            <Link to="/" className="text-foreground hover:text-primary transition-all font-medium text-base relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 hover:after:w-full after:bg-primary after:transition-all">
              Home
            </Link>
            <Link to="/about" className="text-foreground hover:text-primary transition-all font-medium text-base relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 hover:after:w-full after:bg-primary after:transition-all">
              About
            </Link>
            <Link to="/services" className="text-foreground hover:text-primary transition-all font-medium text-base relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 hover:after:w-full after:bg-primary after:transition-all">
              Services
            </Link>
            <Link to="/pricing" className="text-foreground hover:text-primary transition-all font-medium text-base relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 hover:after:w-full after:bg-primary after:transition-all">
              Pricing
            </Link>
            <Link to="/news" className="text-foreground hover:text-primary transition-all font-medium text-base relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 hover:after:w-full after:bg-primary after:transition-all">
              News
            </Link>
            <Link to="/contact" className="text-foreground hover:text-primary transition-all font-medium text-base relative after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-0 hover:after:w-full after:bg-primary after:transition-all">
              Contact
            </Link>
          </nav>
          
          <div className="flex items-center gap-4">
            <Button 
              size="lg"
              className="bg-gradient-to-r from-primary to-primary-dark hover:from-primary-dark hover:to-primary text-primary-foreground shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all duration-300 font-semibold px-8 transform hover:scale-105"
              asChild
            >
              <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                Become a Merchant
              </a>
            </Button>
            <button className="lg:hidden p-2 hover:bg-muted rounded-lg transition-colors">
              <Menu className="w-6 h-6 text-foreground" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
