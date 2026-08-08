using UnityEngine;

namespace RunToExit.Core
{
    [CreateAssetMenu(fileName = "NewLevelData", menuName = "RunToExit/LevelData")]
    public class LevelData : ScriptableObject
    {
        public string LevelName = "Stage 1";
        
        [TextArea(10, 50)]
        [Tooltip("マップを文字で表現します。例: \n# : 壁/床\nP : プレイヤー\nB : 木箱")]
        public string MapLayout;
    }
}
