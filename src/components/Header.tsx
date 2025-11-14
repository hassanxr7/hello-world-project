import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import logo from "@/assets/hubdexpay-logo.png";

const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="HubdexPay Logo" className="h-10 w-auto" />
          </Link>
          
          <nav className="hidden md:flex items-center gap-8">
            <Link to="/" className="text-foreground hover:text-primary transition-colors">
              Home
            </Link>
            <Link to="/about" className="text-foreground hover:text-primary transition-colors">
              About
            </Link>
            <Link to="/services" className="text-foreground hover:text-primary transition-colors">
              Services
            </Link>
            <Link to="/pricing" className="text-foreground hover:text-primary transition-colors">
              Pricing
            </Link>
            <Link to="/news" className="text-foreground hover:text-primary transition-colors">
              News
            </Link>
            <Link to="/contact" className="text-foreground hover:text-primary transition-colors">
              Contact
            </Link>
          </nav>
          
          <div className="flex items-center gap-3">
            <Button 
              className="bg-primary hover:bg-primary-dark text-primary-foreground shadow-[var(--shadow-soft)] transition-all hover:shadow-[var(--shadow-strong)]"
              asChild
            >
              <a href="https://nebdex.com/merchant/register" target="_blank" rel="noopener noreferrer">
                Become a Merchant
              </a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
