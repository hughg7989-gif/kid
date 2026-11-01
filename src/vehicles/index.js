/* Vehicles Registry */
import { CarVehicle } from './car.js';
import { BusVehicle } from './bus.js';
import { TruckVehicle } from './truck.js';
import { TractorVehicle } from './tractor.js';

export const VEHICLES = [
  CarVehicle,
  BusVehicle,
  TruckVehicle,
  TractorVehicle,
];

export function getVehicleById(id) {
  return VEHICLES.find(v => v.id === id) || VEHICLES[0];
}
