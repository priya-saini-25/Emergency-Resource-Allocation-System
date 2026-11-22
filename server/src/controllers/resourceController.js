import Resource, { RESOURCE_TYPES, RESOURCE_STATUSES } from '../models/Resource.js';
import { getConnectionStatus } from '../config/database.js';

/**
 * Controller: List resources with filtering, pagination, and sorting.
 * GET /api/resources
 * Roles: OPERATOR, ADMIN
 */
export async function listResources(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Resource service is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const query = {};

    // 1. Status Filter
    if (req.query.status) {
      const s = String(req.query.status).trim().toUpperCase();
      if (!RESOURCE_STATUSES.includes(s)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter: ${req.query.status}`,
          error: { code: 'INVALID_STATUS_FILTER', allowed: RESOURCE_STATUSES }
        });
      }
      query.status = s;
    }

    // 2. Resource Type Filter
    if (req.query.resourceType || req.query.type) {
      const t = String(req.query.resourceType || req.query.type).trim().toUpperCase();
      if (!RESOURCE_TYPES.includes(t)) {
        return res.status(400).json({
          success: false,
          message: `Invalid resource type filter: ${t}`,
          error: { code: 'INVALID_TYPE_FILTER', allowed: RESOURCE_TYPES }
        });
      }
      query.resourceType = t;
    }

    // 3. Station ID
    if (req.query.stationId) {
      query.stationId = String(req.query.stationId).trim();
    }

    // 4. Text Search (name or stationId)
    if (req.query.search) {
      const searchRegex = new RegExp(String(req.query.search).trim(), 'i');
      query.$or = [{ name: searchRegex }, { stationId: searchRegex }];
    }

    // 5. Pagination
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const skip = (page - 1) * limit;

    // 6. Sorting
    const allowedSortFields = ['resourceId', 'name', 'status', 'resourceType', 'createdAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'resourceId';
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;

    const [totalCount, resources] = await Promise.all([
      Resource.countDocuments(query),
      Resource.find(query)
        .sort({ [sortBy]: sortOrder, resourceId: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const formatted = resources.map((r) => ({
      resourceId: r.resourceId,
      name: r.name,
      resourceType: r.resourceType,
      status: r.status,
      capacity: r.capacity,
      location: {
        latitude: r.latitude,
        longitude: r.longitude
      },
      currentNodeOsmId: r.currentNodeOsmId,
      assignedIncidentId: r.assignedIncidentId,
      assignedBatchId: r.assignedBatchId,
      assignedDispatchId: r.assignedDispatchId,
      reservedAt: r.reservedAt,
      dispatchedAt: r.dispatchedAt,
      stationId: r.stationId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return res.status(200).json({
      success: true,
      message: 'Resources retrieved successfully',
      data: {
        resources: formatted,
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
 * Controller: Get resource inventory statistics.
 * GET /api/resources/stats
 * Roles: OPERATOR, ADMIN
 */
export async function getResourceStats(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Resource statistics are temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const [statusAggregation, typeAggregation, totalCount] = await Promise.all([
      Resource.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Resource.aggregate([
        { $group: { _id: '$resourceType', count: { $sum: 1 } } }
      ]),
      Resource.countDocuments()
    ]);

    const byStatus = {};
    for (const item of statusAggregation) {
      if (item && item._id) byStatus[item._id] = item.count;
    }

    const byType = {};
    for (const item of typeAggregation) {
      if (item && item._id) byType[item._id] = item.count;
    }

    return res.status(200).json({
      success: true,
      message: 'Resource statistics retrieved successfully',
      data: {
        totalResources: totalCount,
        availableCount: byStatus.AVAILABLE || 0,
        reservedCount: byStatus.RESERVED || 0,
        dispatchedCount: byStatus.DISPATCHED || 0,
        outOfServiceCount: byStatus.OUT_OF_SERVICE || 0,
        byStatus,
        byType
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get resource by numeric ID.
 * GET /api/resources/:resourceId
 * Roles: OPERATOR, ADMIN
 */
export async function getResourceById(req, res, next) {
  try {
    const dbStatus = getConnectionStatus();
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        message: 'Resource detail is temporarily unavailable. Database is disconnected.',
        error: { code: 'DATABASE_UNAVAILABLE' }
      });
    }

    const idNum = Number(req.params.resourceId);
    if (!Number.isInteger(idNum) || idNum < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid resource ID. Must be a positive integer.',
        error: { code: 'INVALID_RESOURCE_ID', value: req.params.resourceId }
      });
    }

    const resource = await Resource.findOne({ resourceId: idNum }).lean();
    if (!resource) {
      return res.status(404).json({
        success: false,
        message: `Resource with ID ${idNum} not found`,
        error: { code: 'RESOURCE_NOT_FOUND', resourceId: idNum }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Resource retrieved successfully',
      data: {
        resource: {
          resourceId: resource.resourceId,
          name: resource.name,
          resourceType: resource.resourceType,
          status: resource.status,
          capacity: resource.capacity,
          location: {
            latitude: resource.latitude,
            longitude: resource.longitude
          },
          currentNodeOsmId: resource.currentNodeOsmId,
          assignedIncidentId: resource.assignedIncidentId,
          assignedBatchId: resource.assignedBatchId,
          assignedDispatchId: resource.assignedDispatchId,
          reservedAt: resource.reservedAt,
          dispatchedAt: resource.dispatchedAt,
          stationId: resource.stationId,
          createdAt: resource.createdAt,
          updatedAt: resource.updatedAt
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

export default {
  listResources,
  getResourceStats,
  getResourceById
};

