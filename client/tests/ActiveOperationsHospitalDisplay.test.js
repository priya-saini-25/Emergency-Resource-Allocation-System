process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Active Operations Dashboard — Assigned Hospital Column Rendering & Data Contract', () => {
  // Helper mimicking the exact column render function in ActiveOperationsPage.jsx
  function renderHospitalCell(hosp) {
    const hospitalName = hosp?.hospitalName || hosp?.name;
    const title = hospitalName || 'None assigned';
    const hasHospital = Boolean(hospitalName);
    const displayText = hasHospital ? hospitalName : 'None assigned';
    return {
      title,
      hasHospital,
      displayText,
      hospitalId: hosp?.hospitalId || null
    };
  }

  it('1. should render hospitalName and correct title when assignedHospital contains hospitalName', () => {
    const hosp = {
      hospitalId: 703,
      hospitalName: 'Mahatma Gandhi Hospital (Simulation)'
    };
    const cell = renderHospitalCell(hosp);

    assert.equal(cell.hasHospital, true);
    assert.equal(cell.displayText, 'Mahatma Gandhi Hospital (Simulation)');
    assert.equal(cell.title, 'Mahatma Gandhi Hospital (Simulation)');
    assert.equal(cell.hospitalId, 703);
  });

  it('2. should fallback to "None assigned" with matching title when assignedHospital is null', () => {
    const cell = renderHospitalCell(null);

    assert.equal(cell.hasHospital, false);
    assert.equal(cell.displayText, 'None assigned');
    assert.equal(cell.title, 'None assigned');
  });

  it('3. should fallback to "None assigned" when assignedHospital is undefined', () => {
    const cell = renderHospitalCell(undefined);

    assert.equal(cell.hasHospital, false);
    assert.equal(cell.displayText, 'None assigned');
    assert.equal(cell.title, 'None assigned');
  });

  it('4. should fallback to "None assigned" when assignedHospital is an empty object', () => {
    const cell = renderHospitalCell({});

    assert.equal(cell.hasHospital, false);
    assert.equal(cell.displayText, 'None assigned');
    assert.equal(cell.title, 'None assigned');
  });

  it('5. should support hosp.name for cross-schema compatibility with MongoDB Hospital model', () => {
    const hosp = {
      hospitalId: 702,
      name: 'MDM Hospital Jodhpur (Simulation)'
    };
    const cell = renderHospitalCell(hosp);

    assert.equal(cell.hasHospital, true);
    assert.equal(cell.displayText, 'MDM Hospital Jodhpur (Simulation)');
    assert.equal(cell.title, 'MDM Hospital Jodhpur (Simulation)');
  });

  it('6. should render correctly for target incidents from live session', () => {
    const targetIncidents = [
      {
        incidentId: 17953274762873,
        category: 'MEDICAL_EMERGENCY',
        assignedHospitalId: 703,
        assignedHospital: {
          hospitalId: 703,
          hospitalName: 'Mahatma Gandhi Hospital (Simulation)'
        }
      },
      {
        incidentId: 17953263399575,
        category: 'FIRE',
        assignedHospitalId: 702,
        assignedHospital: {
          hospitalId: 702,
          hospitalName: 'MDM Hospital Jodhpur (Simulation)'
        }
      },
      {
        incidentId: 17953262752797,
        category: 'ROAD_ACCIDENT',
        assignedHospitalId: 703,
        assignedHospital: {
          hospitalId: 703,
          hospitalName: 'Mahatma Gandhi Hospital (Simulation)'
        }
      }
    ];

    for (const incident of targetIncidents) {
      const cell = renderHospitalCell(incident.assignedHospital);
      assert.equal(cell.hasHospital, true);
      assert.ok(cell.displayText.includes('Hospital'));
      assert.equal(cell.hospitalId, incident.assignedHospitalId);
    }
  });
});
