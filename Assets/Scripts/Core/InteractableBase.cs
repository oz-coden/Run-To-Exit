using UnityEngine;

namespace RunToExit.Core
{
    public abstract class InteractableBase : MonoBehaviour
    {
        public Vector2Int GridPosition => new Vector2Int(Mathf.RoundToInt(transform.position.x), Mathf.RoundToInt(transform.position.y));

        // 障害物かどうか（通行をブロックするか）
        public virtual bool IsObstacle(CharacterBase character) => false;

        // キャラクターがこのオブジェクトに対してアクションを起こした時の処理
        public abstract void OnInteract(CharacterBase character);
    }
}
