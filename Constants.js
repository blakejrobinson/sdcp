const SDCP_FROM = Object.freeze(
{
    PC: 0,         // Local PC Software Local Area Network
    WEB_PC: 1,     // PC Software via WEB
    WEB: 2,        // Web Client
    APP: 3,        // APP
    SERVER: 4      // Server
});

const SDCP_FILE_TRANSFER_ACK = Object.freeze(
{
    SUCCESS: 0,        // Success
    NOT_TRANSFER: 1,   // The printer is not currently transferring files.
    CHECKING: 2,       // The printer is already in the file verification phase.
    NOT_FOUND: 3       // File not found.
});

const SDCP_PRINT_ERROR = Object.freeze(
{
    NONE: 0,                   // Normal
    CHECK: 1,                  // File MD5 Check Failed
    FILEIO: 2,                 // File Read Failed
    INVALID_RESOLUTION: 3,     // Resolution Mismatch
    UNKNOWN_FORMAT: 4,         // Format Mismatch
    UNKNOWN_MODEL: 5           // Machine Model Mismatch
});

const SDCP_PRINT_STATUS = Object.freeze(
{
    IDLE: 0,
    HOMING: 1,
    DROPPING: 2,
    EXPOSURING: 3,
    LIFTING: 4,
    PAUSING: 5,
    PAUSED: 6,
    STOPPING: 7,
    STOPPED: 8,
    COMPLETE: 9,
    FILE_CHECKING: 10
});

const SDCP_MACHINE_STATUS = Object.freeze(
{
    IDLE: 0,
    PRINTING: 1,
    FILE_TRANSFERRING: 2,
    EXPOSURE_TESTING: 3,
    DEVICES_TESTING: 4
});

const SDCP_PRINT_TASKSTATUS = Object.freeze(
{
	OTHER: 0,
	COMPLETED: 1,
	EXCEPTIONAL: 2,
	STOPPED: 3
});

const SDCP_PRINT_TASKSTATUS_DESCRIPTIONS = Object.freeze(
{
	[SDCP_PRINT_TASKSTATUS.OTHER]: "Other Status",
	[SDCP_PRINT_TASKSTATUS.COMPLETED]: "Completed",
	[SDCP_PRINT_TASKSTATUS.EXCEPTIONAL]: "Exceptional Status",
	[SDCP_PRINT_TASKSTATUS.STOPPED]: "Stopped"
});

const SDCP_PRINT_TASKERROR = Object.freeze(
{
    OK: 0,
    TEMP_ERROR: 1,
    CALIBRATE_FAILED: 2,
    RESIN_LACK: 3,
    RESIN_OVER: 4,
    PROBE_FAIL: 5,
    FOREIGN_BODY: 6,
    LEVEL_FAILED: 7,
    RELEASE_FAILED: 8,
    SG_OFFLINE: 9,
    LCD_DET_FAILED: 10,
    RELEASE_OVERCOUNT: 11,
    UDISK_REMOVE: 12,
    HOME_FAILED_X: 13,
    HOME_FAILED_Z: 14,
    RESIN_ABNORMAL_HIGH: 15,
    RESIN_ABNORMAL_LOW: 16,
    HOME_FAILED: 17,
    PLAT_FAILED: 18,
    ERROR: 19,
    MOVE_ABNORMAL: 20,
    AIC_MODEL_NONE: 21,
    AIC_MODEL_WARP: 22,
    HOME_FAILED_Y: 23,
    FILE_ERROR: 24,
    CAMERA_ERROR: 25,
    NETWORK_ERROR: 26,
    SERVER_CONNECT_FAILED: 27,
    DISCONNECT_APP: 28,
    CHECK_AUTO_RESIN_FEEDER: 29,
    CONTAINER_RESIN_LOW: 30,
    BOTTLE_DISCONNECT: 31,
    FEED_TIMEOUT: 32,
    TANK_TEMP_SENSOR_OFFLINE: 33,
    TANK_TEMP_SENSOR_ERROR: 34
});

const SDCP_PRINT_TASKERROR_DESCRIPTIONS = Object.freeze(
{
    [SDCP_PRINT_TASKERROR.OK]: "Normal",
    [SDCP_PRINT_TASKERROR.TEMP_ERROR]: "Over-temperature",
    [SDCP_PRINT_TASKERROR.CALIBRATE_FAILED]: "Strain Gauge Calibration Failed",
    [SDCP_PRINT_TASKERROR.RESIN_LACK]: "Resin Level Low Detected",
    [SDCP_PRINT_TASKERROR.RESIN_OVER]: "The volume of resin required by the model exceeds the maximum capacity of the resin vat",
    [SDCP_PRINT_TASKERROR.PROBE_FAIL]: "No Resin Detected",
    [SDCP_PRINT_TASKERROR.FOREIGN_BODY]: "Foreign Object Detected",
    [SDCP_PRINT_TASKERROR.LEVEL_FAILED]: "Auto-leveling Failed",
    [SDCP_PRINT_TASKERROR.RELEASE_FAILED]: "Model Detachment Detected",
    [SDCP_PRINT_TASKERROR.SG_OFFLINE]: "Strain Gauge Not Connected",
    [SDCP_PRINT_TASKERROR.LCD_DET_FAILED]: "LCD Screen Connection Abnormal",
    [SDCP_PRINT_TASKERROR.RELEASE_OVERCOUNT]: "The cumulative release film usage has reached the maximum value",
    [SDCP_PRINT_TASKERROR.UDISK_REMOVE]: "USB drive detected as removed, printing has been stopped",
    [SDCP_PRINT_TASKERROR.HOME_FAILED_X]: "Detection of X-axis motor anomaly, printing has been stopped",
    [SDCP_PRINT_TASKERROR.HOME_FAILED_Z]: "Detection of Z-axis motor anomaly, printing has been stopped",
    [SDCP_PRINT_TASKERROR.RESIN_ABNORMAL_HIGH]: "The resin level has been detected to exceed the maximum value, and printing has been stopped",
    [SDCP_PRINT_TASKERROR.RESIN_ABNORMAL_LOW]: "Resin level detected as too low, printing has been stopped",
    [SDCP_PRINT_TASKERROR.HOME_FAILED]: "Home position calibration failed, please check if the motor or limit switch is functioning properly",
    [SDCP_PRINT_TASKERROR.PLAT_FAILED]: "A model is detected on the platform; please clean it and then restart printing",
    [SDCP_PRINT_TASKERROR.ERROR]: "Printing Exception",
    [SDCP_PRINT_TASKERROR.MOVE_ABNORMAL]: "Motor Movement Abnormality",
    [SDCP_PRINT_TASKERROR.AIC_MODEL_NONE]: "No model detected, please troubleshoot",
    [SDCP_PRINT_TASKERROR.AIC_MODEL_WARP]: "Warping of the model detected, please investigate",
    [SDCP_PRINT_TASKERROR.HOME_FAILED_Y]: "Deprecated",
    [SDCP_PRINT_TASKERROR.FILE_ERROR]: "Error File",
    [SDCP_PRINT_TASKERROR.CAMERA_ERROR]: "Camera Error. Please check if the camera is properly connected, or you can also disable this feature to continue printing",
    [SDCP_PRINT_TASKERROR.NETWORK_ERROR]: "Network Connection Error. Please check if your network connection is stable, or you can also disable this feature to continue printing",
    [SDCP_PRINT_TASKERROR.SERVER_CONNECT_FAILED]: "Server Connection Failed. Please contact our customer support, or you can also disable this feature to continue printing",
    [SDCP_PRINT_TASKERROR.DISCONNECT_APP]: "This printer is not bound to an app. To perform time-lapse photography, please first enable the remote control feature, or you can also disable this feature to continue printing",
    [SDCP_PRINT_TASKERROR.CHECK_AUTO_RESIN_FEEDER]: "Please check the installation of the 'automatic material extraction / feeding machine'",
    [SDCP_PRINT_TASKERROR.CONTAINER_RESIN_LOW]: "The resin in the container is running low. Add more resin to automatically close this notification, or click 'Stop Auto Feeding' to continue printing",
    [SDCP_PRINT_TASKERROR.BOTTLE_DISCONNECT]: "Please ensure that the automatic material extraction/feeding machine is correctly installed and the data cable is connected",
    [SDCP_PRINT_TASKERROR.FEED_TIMEOUT]: "Automatic material extraction timeout, please check if the resin tube is blocked",
    [SDCP_PRINT_TASKERROR.TANK_TEMP_SENSOR_OFFLINE]: "Resin vat temperature sensor not connected",
    [SDCP_PRINT_TASKERROR.TANK_TEMP_SENSOR_ERROR]: "Resin vat temperature sensor indicates an over-temperature condition"
});

const SDCP_ERROR_CODE = Object.freeze({
    MD5_FAILED: 1,
    FORMAT_FAILED: 2
});

const SDCP_ERROR_CODE_DESCRIPTIONS = Object.freeze({
    [SDCP_ERROR_CODE.MD5_FAILED]: "File Transfer MD5 Check Failed",
    [SDCP_ERROR_CODE.FORMAT_FAILED]: "File format is incorrect"
});

const Constants = {
	SDCP_FROM,
	SDCP_FILE_TRANSFER_ACK,
	SDCP_PRINT_ERROR,
	SDCP_PRINT_STATUS,
	SDCP_MACHINE_STATUS,
	SDCP_PRINT_TASKSTATUS,
	SDCP_PRINT_TASKSTATUS_DESCRIPTIONS,
	SDCP_PRINT_TASKERROR,
	SDCP_PRINT_TASKERROR_DESCRIPTIONS,
	SDCP_ERROR_CODE,
	SDCP_ERROR_CODE_DESCRIPTIONS
}

module.exports = Constants;
