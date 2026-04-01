// 数据库访问层索引文件
const materialRepository = require('./materialRepository');
const mixDesignRepository = require('./mixDesignRepository');
const userRepository = require('./userRepository');
const systemParamRepository = require('./systemParamRepository');

module.exports = {
  materialRepository,
  mixDesignRepository,
  userRepository,
  systemParamRepository
};