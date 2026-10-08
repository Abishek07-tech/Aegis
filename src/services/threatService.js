import { threatMock } from '../data/mock/threats.js'
import { createService } from './serviceFactory.js'
import { getAegisThreats } from './aegisAdapter.js'
export const threatService=createService({endpoint:'/api/threats',mock:threatMock,collection:true,api:{list:getAegisThreats}})
