// General specs for common mechanical movements, shown when an automatic is identified.
// Deliberately no quartz movement -> battery entries here: those come only from web evidence
// and from what you confirm after opening a watch, so nothing gets "remembered" wrongly.

const auto = (maker, calibre, aliases, specs) => ({ maker, calibre, aliases, movement_type: 'automatic', ...specs });

export const MECHANICAL_MOVEMENTS = [
  auto('seiko', 'NH35A', ['NH35', '4R35'], { jewels: 24, bph: 21600, power_reserve_h: 41, hacking: true, hand_winding: true, complications: 'date' }),
  auto('seiko', 'NH36A', ['NH36', '4R36'], { jewels: 24, bph: 21600, power_reserve_h: 41, hacking: true, hand_winding: true, complications: 'day-date' }),
  auto('seiko', '7S26', [], { jewels: 21, bph: 21600, power_reserve_h: 41, hacking: false, hand_winding: false, complications: 'day-date' }),
  auto('seiko', '7S36', [], { jewels: 23, bph: 21600, power_reserve_h: 41, hacking: false, hand_winding: false, complications: 'day-date' }),
  auto('seiko', '6R15', [], { jewels: 23, bph: 21600, power_reserve_h: 50, hacking: true, hand_winding: true, complications: 'date' }),
  auto('seiko', '6R35', [], { jewels: 24, bph: 21600, power_reserve_h: 70, hacking: true, hand_winding: true, complications: 'date' }),
  auto('miyota', '8215', [], { jewels: 21, bph: 21600, power_reserve_h: 42, hacking: false, hand_winding: true, complications: 'date' }),
  auto('miyota', '8205', [], { jewels: 21, bph: 21600, power_reserve_h: 42, hacking: false, hand_winding: true, complications: 'day-date' }),
  auto('miyota', '9015', [], { jewels: 24, bph: 28800, power_reserve_h: 42, hacking: true, hand_winding: true, complications: 'date' }),
  auto('orient', 'F6922', [], { jewels: 22, bph: 21600, power_reserve_h: 40, hacking: true, hand_winding: true, complications: 'date' }),
  auto('orient', '46943', [], { jewels: 21, bph: 21600, power_reserve_h: 40, hacking: false, hand_winding: false, complications: 'day-date' }),
  auto('eta', '2824-2', ['2824'], { jewels: 25, bph: 28800, power_reserve_h: 38, hacking: true, hand_winding: true, complications: 'date' }),
  auto('eta', '2892-A2', ['2892'], { jewels: 21, bph: 28800, power_reserve_h: 42, hacking: true, hand_winding: true, complications: 'date' }),
  auto('eta', 'Valjoux 7750', ['7750'], { jewels: 25, bph: 28800, power_reserve_h: 44, hacking: true, hand_winding: true, complications: 'chronograph, day-date' }),
  auto('eta', 'Powermatic 80', ['C07.111', 'C07111'], { bph: 21600, power_reserve_h: 80, hacking: true, hand_winding: true, complications: 'date' }),
  auto('sellita', 'SW200-1', ['SW200'], { jewels: 26, bph: 28800, power_reserve_h: 38, hacking: true, hand_winding: true, complications: 'date' }),
];
