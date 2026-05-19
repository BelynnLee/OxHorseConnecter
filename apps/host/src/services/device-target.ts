import type { DeviceRepository } from '@rac/storage';
import type { Device, ExecutorType } from '@rac/shared';
import type { TaskService } from './task-service.js';
import { HttpError } from './errors.js';

export class DeviceTargetError extends HttpError {
  constructor(
    statusCode: number,
    message: string,
    public readonly deviceId: string,
  ) {
    super(statusCode, message);
    this.name = 'DeviceTargetError';
  }
}

export function shortDeviceId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function deviceLabel(device: Pick<Device, 'id' | 'name'>): string {
  return `"${device.name}" (${shortDeviceId(device.id)})`;
}

export function isExecutorAvailableForDevice(
  taskService: Pick<TaskService, 'hasExecutor' | 'isLocalDevice'>,
  device: Device,
  executorType: ExecutorType,
): boolean {
  if (taskService.isLocalDevice(device.id)) {
    return taskService.hasExecutor(executorType);
  }

  return Boolean(
    device.executors?.some(
      (executor) => executor.type === executorType && executor.available,
    ),
  );
}

export function requireRunnableDeviceTarget(
  deviceRepo: DeviceRepository,
  taskService: Pick<TaskService, 'hasExecutor' | 'isLocalDevice'>,
  deviceId: string,
  executorType: ExecutorType,
): Device {
  const device = deviceRepo.findById(deviceId);
  if (!device) {
    throw new DeviceTargetError(404, `Device not found: ${shortDeviceId(deviceId)}`, deviceId);
  }

  if (!device.trusted) {
    throw new DeviceTargetError(403, `Device ${deviceLabel(device)} is not trusted.`, device.id);
  }

  if (device.status !== 'online') {
    throw new DeviceTargetError(400, `Device ${deviceLabel(device)} is offline.`, device.id);
  }

  if (!taskService.isLocalDevice(device.id) && (!device.workRoot || device.workRootExists !== true)) {
    throw new DeviceTargetError(
      400,
      `Device ${deviceLabel(device)} has not reported a usable workspace root.`,
      device.id,
    );
  }

  if (!isExecutorAvailableForDevice(taskService, device, executorType)) {
    const message = taskService.isLocalDevice(device.id)
      ? `Executor "${executorType}" is not enabled on host device ${deviceLabel(device)}.`
      : `Executor "${executorType}" is not available on device ${deviceLabel(device)}.`;
    throw new DeviceTargetError(400, message, device.id);
  }

  return device;
}
