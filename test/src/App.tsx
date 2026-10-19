import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';

const PageLayout = ({ children, title }) => (
  <div className="container">
    <h1>{title}</h1>
    <div className="content">{children}</div>
  </div>
);

const Home = () => (
  <PageLayout title="Welcome to the Beautiful Site">
    <p>Experience the elegance of modern web design. We believe in simplicity, functionality, and beauty.</p>
    <div className="hero-card">
      <h3>Explore Our World</h3>
      <p>Discover how we can help you achieve your goals with our curated services.</p>
      <Link to="/services" className="btn">View Services</Link>
    </div>
  </PageLayout>
);

const About = () => (
  <PageLayout title="About Us">
    <p>We are a team of passionate designers and developers dedicated to creating stunning digital experiences.</p>
    <p>Our mission is to bridge the gap between aesthetics and usability.</p>
  </PageLayout>
);

const Services = () => (
  <PageLayout title="Our Services">
    <div className="services-grid">
      <div className="service-item">
        <h4>Web Design</h4>
        <p>Creating visually stunning and intuitive user interfaces.</p>
      </div>
      <div className="service-item">
        <h4>Development</h4>
        <p>Building robust, scalable, and high-performance applications.</p>
      </div>
      <div className="service-item">
        <h4>Consulting</h4>
        <p>Providing expert guidance on digital strategy and growth.</p>
      </div>
    </div>
  </PageLayout>
);

const Contact = () => (
  <PageLayout title="Contact Us">
    <p>Have a project in mind? We'd love to hear from you!</p>
    <form className="contact-form" onSubmit={(e) => e.preventDefault()}>
      <input type="text" placeholder="Your Name" className="form-input" />
      <input type="email" placeholder="Your Email" className="form-input" />
      <textarea placeholder="Your Message" className="form-input" rows="4"></textarea>
      <button type="submit" className="btn">Send Message</button>
    </form>
  </PageLayout>
);

const App = () => {
  return (
    <div className="app-wrapper">
      <nav>
        <div className="nav-brand">BeautifulSite</div>
        <div className="nav-links">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/services">Services</Link>
          <Link to="/contact">Contact</Link>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/services" element={<Services />} />
        <Route path="/contact" element={<Contact />} />
      </Routes>
      <footer className="footer">
        <p>&copy; 2023 BeautifulSite. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;