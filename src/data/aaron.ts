export type Svc = {
  id: string;
  group: string;
  name: string;
  line: string;
  labor: number;
  minutes: number | null;
  each?: number;
  icon: string;
  homeName?: string;
  homeLine?: string;
  homeTimeNote?: string;
};

export const services: Svc[] = [
  { id: "oil", group: "Maintenance", name: "Oil change", line: "Oil and filter.", labor: 50, minutes: 60, icon: "oil" },
  { id: "plugs-4", group: "Maintenance", name: "Spark plugs, 4 cylinder", line: "4 cylinder.", labor: 100, minutes: 60, icon: "plug", homeName: "Spark plugs", homeLine: "4-cyl $100, 1h. 6-cyl $200, 2h. 8-cyl $250, 2h 30m.", homeTimeNote: "4-cyl" },
  { id: "plugs-6", group: "Maintenance", name: "Spark plugs, 6 cylinder", line: "6 cylinder.", labor: 200, minutes: 120, icon: "plug" },
  { id: "plugs-8", group: "Maintenance", name: "Spark plugs, 8 cylinder", line: "8 cylinder.", labor: 250, minutes: 150, icon: "plug" },
  { id: "ignition-coil", group: "Maintenance", name: "Ignition coil", line: "$50 each, plus starting labor.", labor: 50, minutes: 30, each: 50, icon: "coil" },
  { id: "belt", group: "Maintenance", name: "Serpentine belt", line: "Serpentine belt.", labor: 100, minutes: 60, icon: "belt" },
  { id: "battery", group: "Maintenance", name: "Battery replacement", line: "Battery replacement.", labor: 50, minutes: 45, icon: "battery" },
  { id: "terminal", group: "Maintenance", name: "Battery terminal", line: "Battery terminal.", labor: 100, minutes: 60, icon: "terminal" },

  { id: "pads", group: "Brakes and steering", name: "Brake pads, front or rear", line: "Front or rear.", labor: 150, minutes: 90, icon: "brake" },
  { id: "pads-rotors", group: "Brakes and steering", name: "Brake pads and rotors, front or rear", line: "Front or rear.", labor: 200, minutes: 120, icon: "brake" },
  { id: "strut", group: "Brakes and steering", name: "Strut / shock", line: "Strut or shock.", labor: 150, minutes: 90, icon: "shock" },
  { id: "control-arm", group: "Brakes and steering", name: "Control arm", line: "Control arm.", labor: 150, minutes: 90, icon: "arm" },
  { id: "ball-joint", group: "Brakes and steering", name: "Ball joint", line: "Ball joint.", labor: 150, minutes: 90, icon: "hub" },
  { id: "hub", group: "Brakes and steering", name: "Wheel hub / bearing", line: "Wheel hub or bearing.", labor: 150, minutes: 90, icon: "hub" },
  { id: "tie-rod", group: "Brakes and steering", name: "Tie rod end", line: "Tie rod end.", labor: 100, minutes: 60, icon: "arm" },
  { id: "cv-axle", group: "Brakes and steering", name: "CV axle", line: "CV axle.", labor: 200, minutes: 90, icon: "axle" },

  { id: "water-pump", group: "Cooling", name: "Water pump", line: "Water pump.", labor: 250, minutes: 150, icon: "pump" },
  { id: "radiator", group: "Cooling", name: "Radiator", line: "Radiator.", labor: 200, minutes: 120, icon: "radiator" },
  { id: "thermostat", group: "Cooling", name: "Thermostat", line: "Thermostat.", labor: 150, minutes: 90, icon: "thermo" },
  { id: "pressure-test", group: "Cooling", name: "Cooling system pressure test", line: "Pressure test.", labor: 100, minutes: 60, icon: "thermo" },
  { id: "heater-hose", group: "Cooling", name: "Heater hose", line: "Heater hose.", labor: 100, minutes: 60, icon: "hose" },
  { id: "coolant-hose", group: "Cooling", name: "Coolant hose", line: "Coolant hose.", labor: 50, minutes: null, icon: "hose" },

  { id: "valve-cover", group: "Engine", name: "Valve cover gasket", line: "Valve cover gasket.", labor: 150, minutes: 90, icon: "gasket" },

  { id: "alternator", group: "Electrical", name: "Alternator", line: "Alternator.", labor: 150, minutes: 90, icon: "bolt" },
  { id: "starter", group: "Electrical", name: "Starter", line: "Starter.", labor: 150, minutes: 90, icon: "bolt" },
  { id: "window", group: "Electrical", name: "Window regulator", line: "Window regulator.", labor: 150, minutes: 90, icon: "window" },
  { id: "clock-spring", group: "Electrical", name: "Clock spring", line: "Clock spring.", labor: 200, minutes: 120, icon: "window" },

  { id: "ac-compressor", group: "Air conditioning", name: "A/C compressor", line: "Evac and recharge included.", labor: 300, minutes: 180, icon: "ac" },
  { id: "ac-evac", group: "Air conditioning", name: "A/C evacuate and recharge", line: "Evacuate and recharge.", labor: 150, minutes: 90, icon: "ac" },
  { id: "blend-door", group: "Air conditioning", name: "Blend door actuator", line: "Blend door actuator.", labor: 100, minutes: 60, icon: "window" },

  { id: "something-else", group: "Quote", name: "Something else", line: "Put the VIN and details in the notes and I will quote it.", labor: 150, minutes: 120, icon: "wrench" },
];

export const homeIds = ["oil", "pads", "battery", "plugs-4", "alternator", "ac-compressor", "water-pump", "something-else"];

export const homeServices = homeIds.map((id) => {
  const svc = services.find((item) => item.id === id);
  if (!svc) throw new Error(`Missing home service ${id}`);
  return svc;
});

export const groups = (() => {
  const order: string[] = [];
  for (const svc of services) {
    if (!order.includes(svc.group)) order.push(svc.group);
  }
  return order.map((name) => ({
    name,
    items: services.filter((svc) => svc.group === name),
  }));
})();

export function formatDuration(minutes: number | null): string | null {
  if (minutes == null) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}
