import Hospital, { HOSPITAL_STATUSES, HOSPITAL_CAPABILITIES } from '../models/Hospital.js';
import { getConnectionStatus } from '../config/database.js';

/**
 * Controller: List hospitals with filtering, pagination, and sorting.
 * GET /api/hospitals
 * Roles: OPERATOR, ADMIN
 */
export async function listHospitals(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Hospital service is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const query = {};

    // 1. Status Filter
    if (req.query.status) {
      const s = String(req.query.status).trim().toUpperCase();
      if (!HOSPITAL_STATUSES.includes(s)) {
        return res.status(400).json({
          success: false,
          message: `Invalid hospital status filter: ${req.query.status}`,
          error: { code: 'INVALID_STATUS_FILTER', allowed: HOSPITAL_STATUSES }
        });
      }
      query.status = s;
    }

    // 2. Capability Filter
    if (req.query.capability) {
      const cap = String(req.query.capability).trim().toUpperCase();
      if (!HOSPITAL_CAPABILITIES.includes(cap)) {
        return res.status(400).json({
          success: false,
          message: `Invalid hospital capability filter: ${cap}`,
          error: { code: 'INVALID_CAPABILITY_FILTER', allowed: HOSPITAL_CAPABILITIES }
        });
      }
      query.capabilities = cap;
    }

    // 3. Search (name)
    if (req.query.search) {
      query.name = new RegExp(String(req.query.search).trim(), 'i');
    }

    // 4. Pagination
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const skip = (page - 1) * limit;

    // 5. Sorting
    const allowedSortFields = ['hospitalId', 'name', 'status', 'createdAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'hospitalId';
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;

    const [totalCount, hospitals] = await Promise.all([
      Hospital.countDocuments(query),
      Hospital.find(query)
        .sort({ [sortBy]: sortOrder, hospitalId: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const formatted = hospitals.map((h) => ({
      hospitalId: h.hospitalId,
      name: h.name,
      status: h.status,
      capabilities: h.capabilities || [],
      location: {
        latitude: h.latitude,
        longitude: h.longitude
      },
      osmNodeId: h.osmNodeId,
      icuBeds: h.icuBeds || { total: 0, available: 0 },
      generalBeds: h.generalBeds || { total: 0, available: 0 },
      oxygenBeds: h.oxygenBeds || { total: 0, available: 0 },
      totalBeds: (h.icuBeds?.total || 0) + (h.generalBeds?.total || 0) + (h.oxygenBeds?.total || 0),
      availableBeds: (h.icuBeds?.available || 0) + (h.generalBeds?.available || 0) + (h.oxygenBeds?.available || 0),
      createdAt: h.createdAt,
      updatedAt: h.updatedAt
    }));

    return res.status(200).json({
      success: true,
      message: 'Hospitals retrieved successfully',
      data: {
        hospitals: formatted,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get aggregate bed capacity statistics.
 * GET /api/hospitals/stats
 * Roles: OPERATOR, ADMIN
 */
export async function getHospitalStats(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Hospital statistics are temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const hospitals = await Hospital.find().lean();

    let totalBeds = 0;
    let availableBeds = 0;
    let totalIcu = 0;
    let availableIcu = 0;
    let totalGeneral = 0;
    let availableGeneral = 0;
    let totalOxygen = 0;
    let availableOxygen = 0;
    let operationalCount = 0;

    for (const h of hospitals) {
      if (h.status === 'OPERATIONAL') operationalCount++;
      const icuT = h.icuBeds?.total || 0;
      const icuA = h.icuBeds?.available || 0;
      const genT = h.generalBeds?.total || 0;
      const genA = h.generalBeds?.available || 0;
      const oxyT = h.oxygenBeds?.total || 0;
      const oxyA = h.oxygenBeds?.available || 0;

      totalIcu += icuT;
      availableIcu += icuA;
      totalGeneral += genT;
      availableGeneral += genA;
      totalOxygen += oxyT;
      availableOxygen += oxyA;

      totalBeds += (icuT + genT + oxyT);
      availableBeds += (icuA + genA + oxyA);
    }

    const occupiedBeds = totalBeds - availableBeds;
    const occupancyRate = totalBeds > 0 ? Number(((occupiedBeds / totalBeds) * 100).toFixed(1)) : 0;

    return res.status(200).json({
      success: true,
      message: 'Hospital network statistics retrieved successfully',
      data: {
        totalHospitals: hospitals.length,
        operationalHospitals: operationalCount,
        totalBeds,
        availableBeds,
        occupiedBeds,
        occupancyRate,
        bedsByCategory: {
          icu: { total: totalIcu, available: availableIcu, occupied: totalIcu - availableIcu },
          general: { total: totalGeneral, available: availableGeneral, occupied: totalGeneral - availableGeneral },
          oxygen: { total: totalOxygen, available: availableOxygen, occupied: totalOxygen - availableOxygen }
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get hospital by numeric ID.
 * GET /api/hospitals/:hospitalId
 * Roles: OPERATOR, ADMIN
 */
export async function getHospitalById(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Hospital detail is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const idNum = Number(req.params.hospitalId);
    if (!Number.isInteger(idNum) || idNum < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hospital ID. Must be a positive integer.',
        error: { code: 'INVALID_HOSPITAL_ID', value: req.params.hospitalId }
      });
    }

    const h = await Hospital.findOne({ hospitalId: idNum }).lean();
    if (!h) {
      return res.status(404).json({
        success: false,
        message: `Hospital with ID ${idNum} not found`,
        error: { code: 'HOSPITAL_NOT_FOUND', hospitalId: idNum }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Hospital details retrieved successfully',
      data: {
        hospital: {
          hospitalId: h.hospitalId,
          name: h.name,
          status: h.status,
          capabilities: h.capabilities || [],
          location: {
            latitude: h.latitude,
            longitude: h.longitude
          },
          osmNodeId: h.osmNodeId,
          icuBeds: h.icuBeds || { total: 0, available: 0 },
          generalBeds: h.generalBeds || { total: 0, available: 0 },
          oxygenBeds: h.oxygenBeds || { total: 0, available: 0 },
          totalBeds: (h.icuBeds?.total || 0) + (h.generalBeds?.total || 0) + (h.oxygenBeds?.total || 0),
          availableBeds: (h.icuBeds?.available || 0) + (h.generalBeds?.available || 0) + (h.oxygenBeds?.available || 0),
          createdAt: h.createdAt,
          updatedAt: h.updatedAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

export default {
  listHospitals,
  getHospitalStats,
  getHospitalById
};

