using System.Collections.Generic;
using UnityEngine;

namespace RunToExit.Core
{
    public class GridNode
    {
        public Vector2Int Position;
        public bool IsWall = false;
        public List<IGridEntity> Entities = new List<IGridEntity>();

        public GridNode(Vector2Int pos)
        {
            Position = pos;
        }

        public bool IsSolid(CharacterBase character)
        {
            if (IsWall) return true;
            foreach (var entity in Entities)
            {
                if (entity.IsSolidTo(character)) return true;
            }
            return false;
        }

        public IGridEntity GetInteractable()
        {
            foreach (var entity in Entities)
            {
                if (entity.IsInteractable) return entity;
            }
            return null;
        }
        
        public T GetEntity<T>() where T : class
        {
            foreach (var entity in Entities)
            {
                if (entity is T typedEntity) return typedEntity;
            }
            return null;
        }
    }
}
