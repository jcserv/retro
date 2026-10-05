import { useLayoutEffect } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";

function RedirectHome() {
  const { route } = useLocation();
  useLayoutEffect(() => route("/", true), [route]);
  return null;
}

export function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Home} />
        <Route path="/r/:code" component={Room} />
        <Route default component={RedirectHome} />
      </Router>
    </LocationProvider>
  );
}
